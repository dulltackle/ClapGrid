"""按清单生成交付包并顺序校验；机械归档结果不代替人工确认。"""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile

CHUNK = 1024 * 1024
INDEX = '.clapgrid-package.json'


def digest(stream):
    value = hashlib.sha256()
    size = 0
    while data := stream.read(CHUNK):
        value.update(data)
        size += len(data)
    return value.hexdigest(), size


def entries(root, manifest_path):
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    files = manifest['files']
    if not isinstance(files, list) or not files:
        raise ValueError('files 必须为非空制作成员清单')
    manifest_name = manifest_path.relative_to(root).as_posix()
    if manifest_name == INDEX:
        raise ValueError('清单自身不能使用归档索引保留路径：' + INDEX)
    members = {}
    index_files = []
    for entry in files:
        path = entry['path']
        if not isinstance(path, str) or not path or '\\' in path or '\x00' in path or PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts or str(PurePosixPath(path)) != path:
            raise ValueError(f'制作成员必须是规范项目相对路径：{path}')
        resolved = (root / path).resolve()
        if not resolved.is_relative_to(root) or (root / path).is_symlink() or not resolved.is_file():
            raise ValueError(f'制作成员不是项目内普通文件：{path}')
        if entry.get('category') not in {'production', 'technical', 'user', 'history'}:
            raise ValueError(f'制作成员缺少明确分类：{path}')
        if not isinstance(entry.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', entry['sha256']):
            raise ValueError(f'制作成员缺少 SHA-256 内容身份：{path}')
        if path == manifest_name:
            raise ValueError('清单自身不能列入 files，避免自引用摘要')
        if path == INDEX:
            raise ValueError('制作成员占用归档索引保留路径：' + INDEX)
        if path in members:
            raise ValueError(f'清单重复成员：{path}')
        with (root / path).open('rb') as source:
            sha, size = digest(source)
        if sha != entry['sha256']:
            raise ValueError(f'制作成员摘要不符：{path}')
        members[path] = {'sha256': sha, 'size': size}
        index_files.append({**entry, 'size': size})
    required = {manifest['typecheck']}
    for segment in manifest['segments']:
        required.update(segment[key] for key in ['card', 'source', 'audio', 'assembly', 'review'])
    if isinstance(manifest.get('evidence'), str):
        required.add(manifest['evidence'])
    if (root / 'video.md').exists():
        required.add('video.md')
    for node in manifest.get('dependencies', {}).get('nodes', []):
        if node.get('path'):
            required.add(node['path'])
    missing_sources = required - set(members)
    if missing_sources:
        raise ValueError('清单遗漏制作输入、素材或审阅记录：' + ', '.join(sorted(missing_sources)))
    manifest_entry = {'path': manifest_name, 'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw)}
    index = {'schemaVersion': 1, 'manifest': manifest_entry, 'files': index_files}
    index_bytes = (json.dumps(index, ensure_ascii=False, indent=2) + '\n').encode()
    members[manifest_name] = {'sha256': manifest_entry['sha256'], 'size': len(raw)}
    members[INDEX] = {'sha256': hashlib.sha256(index_bytes).hexdigest(), 'size': len(index_bytes)}
    return members, index_bytes, manifest_name


def verify(archive, members):
    seen = set()
    order = []
    # tarfile 的顺序模式避免按无序名字反复解压；外层 gzip 读到 EOF 核对 CRC。
    with archive.open('rb') as compressed, gzip.GzipFile(fileobj=compressed, mode='rb') as decoded:
        with tarfile.open(fileobj=decoded, mode='r|', ignore_zeros=True) as package:
            for member in package:
                name = member.name
                if name in seen:
                    raise ValueError(f'归档重复成员：{name}')
                if name not in members:
                    raise ValueError(f'归档额外成员：{name}')
                if not member.isfile():
                    raise ValueError(f'归档成员不是普通文件：{name}')
                stream = package.extractfile(member)
                if stream is None:
                    raise ValueError(f'归档成员无法读取：{name}')
                sha, size = digest(stream)
                if members[name] != {'sha256': sha, 'size': size}:
                    raise ValueError(f'归档成员内容摘要或大小不符：{name}')
                seen.add(name)
                order.append(name)
        while decoded.read(CHUNK):
            pass
    missing = set(members) - seen
    if missing:
        raise ValueError('归档缺失成员：' + ', '.join(sorted(missing)))
    return order


def pack(root, manifest_path, output, members, index_bytes, manifest_name):
    if output.resolve() in {(root / name).resolve() for name in members}:
        raise ValueError(f'输出路径指向制作输入或清单，拒绝覆盖：{output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, candidate_name = tempfile.mkstemp(prefix='.' + output.name + '.candidate-', dir=output.parent)
    os.close(fd)
    candidate = Path(candidate_name)
    try:
        with tarfile.open(candidate, 'w:gz', format=tarfile.PAX_FORMAT) as package:
            index = tarfile.TarInfo(INDEX)
            index.size = len(index_bytes)
            package.addfile(index, io.BytesIO(index_bytes))
            for name in members:
                if name == INDEX:
                    continue
                package.add(root / name, arcname=name, recursive=False)
        order = verify(candidate, members)
        os.replace(candidate, output)
        return {'archive': str(output), 'order': order, 'members': len(order), 'publication': 'published', 'scope': '归档文件完整性；不判定人工确认'}
    except Exception as error:
        raise ValueError(f'{error}；候选包：{candidate}；原交付包保持') from error


def main():
    options = json.load(sys.stdin)
    command = options['command']
    try:
        root = Path(options['project']).resolve()
        manifest_path = (root / options['manifest']).resolve()
        members, index_bytes, manifest_name = entries(root, manifest_path)
        if command == 'pack':
            details = pack(root, manifest_path, Path(options.get('output') or root / 'delivery.tar.gz'), members, index_bytes, manifest_name)
        else:
            if not options.get('archive'):
                raise ValueError('verify-package 必须指定 --archive')
            archive = Path(options['archive'])
            details = {'archive': str(archive), 'order': verify(archive, members), 'publication': 'verified', 'scope': '归档文件完整性；不判定人工确认'}
        result = {'command': command, 'status': 'passed', 'checks': [{'id': 'archive', 'status': 'passed', 'message': '全部归档成员按顺序校验完成'}], 'details': details}
    except Exception as error:
        result = {'command': command, 'status': 'failed', 'checks': [{'id': 'archive', 'status': 'failed', 'message': str(error)}]}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
