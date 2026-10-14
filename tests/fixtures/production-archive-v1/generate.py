"""仅迁移期离线运行：用冻结的旧实现生成独立基线，不属于日常测试。"""
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
SOURCE_COMMIT = 'a55109aa0e93dc3b9d2e5b6f126607adb86d592d'
LEGACY = ROOT / 'legacy/archive.py'
spec = importlib.util.spec_from_file_location('legacy_archive', LEGACY)
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def invoke(python, command, archive):
    options = {'command': command, 'project': str(ROOT / 'project'),
               'manifest': 'production.json', 'archive': str(archive), 'output': str(archive)}
    process = subprocess.run([python, '-B', str(LEGACY)], input=json.dumps(options),
                             text=True, capture_output=True, check=True)
    return json.loads(process.stdout)


def write(path, data):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def repack(items):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for member, data in items:
            archive.addfile(member, io.BytesIO(data))
    return gzip.compress(output.getvalue(), mtime=0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--compare-python', help='可选最低声明版本解释器；不修改全局环境')
    args = parser.parse_args()
    long_path = '/'.join(['中文长路径目录'] * 12) + '/素材原件.bin'
    contents = {'src.ts': b'export const scene = 1;\n', 'card.json': b'{"status":"pending"}\n',
                'audio.wav': bytes(range(256)) * 5, 'assembly.mp4': b'assembly\x00\xff',
                'review.mp4': b'review\n', 'tsconfig.json': b'{}\n',
                'empty.bin': b'', long_path: '原始素材\n'.encode()}
    for name, data in contents.items():
        write('project/' + name, data)
        # 固定文件时间用于观察旧 writer 的有效 mtime PAX；不改旧实现。
        os.utime(ROOT / 'project' / name, (1700000000.125, 1700000000.125))
    entries = []
    for number, (name, data) in enumerate(contents.items()):
        if number == 0:
            entries.append('''{"path":"src.ts","size":999,"10":"十","2":"二","01":"零一",
 "extensions":{"huge":1234567890123456789012345678901234567890,"one":1.0,
 "negativeZero":-0.0,"scientific":1e-7,"overflow":1e400,"negativeOverflow":-1e400,
 "smallFixed":1e-4,"largeFixed":1e15,"largeScientific":1e16,"text":"中文😀\\\\\\\"\\n\\t\\u0001",
 "nested":[{"10":1,"2":2,"x":[1.0,-0.0]}],"duplicate":"first","after":true,"duplicate":"last"},
 "category":"history","position":"first","trailing":null,"position":"last","sha256":"''' + sha(data) + '"}')
        else:
            entries.append(json.dumps({'path': name, 'sha256': sha(data),
                                       'category': 'technical' if name == 'tsconfig.json' else 'production'}, ensure_ascii=False))
    raw = ('{\n "schemaVersion":1,"project":{"width":64,"height":64,"fps":10},\n'
           ' "typecheck":"tsconfig.json","segments":[{"id":"A","frames":6,"card":"card.json",'
           '"source":"src.ts","audio":"audio.wav","assembly":"assembly.mp4","review":"review.mp4"}],\n'
           ' "files":[\n ' + ',\n '.join(entries) + '\n ]\n}\n').encode()
    write('project/production.json', raw)
    os.utime(ROOT / 'project/production.json', (1700000000.125, 1700000000.125))
    members, index, _ = legacy.entries(ROOT / 'project', ROOT / 'project/production.json')
    write('expected-index.json', index)
    good = ROOT / 'valid.tar.gz'
    packed = invoke(sys.executable, 'pack', good)
    assert packed['status'] == 'passed', packed
    verified = invoke(sys.executable, 'verify-package', good)
    assert verified['status'] == 'passed', verified
    tar = gzip.decompress(good.read_bytes())
    with tarfile.open(good) as archive:
        items = [(m, archive.extractfile(m).read()) for m in archive]
    end = max(m.offset_data + ((m.size + 511) // 512) * 512 for m, _ in items)
    # 除 path 外，固定实际有效 size/uid/gid/uname/gname/mtime 的局部 PAX 覆盖。
    pax_items = []
    for m, data in items:
        if m.name == long_path:
            m = tarfile.TarInfo('pax-placeholder')
            m.size = len(data)
            m.pax_headers = {'path': long_path, 'size': str(len(data)), 'uid': '123',
                             'gid': '456', 'uname': '作者', 'gname': '组', 'mtime': '1700000000.125'}
        pax_items.append((m, data))
    pax_tar = bytearray(gzip.decompress(repack(pax_items)))
    with tarfile.open(fileobj=io.BytesIO(pax_tar), mode='r:') as archive:
        overridden = next(m for m in archive if m.name == long_path)
    # size 的 PAX 值必须生效：物理普通头故意写 0，正文仍保留真实长度。
    offset = overridden.offset_data - 512
    pax_tar[offset + 124:offset + 136] = b'00000000000\x00'
    pax_tar[offset + 148:offset + 156] = b' ' * 8
    checksum = sum(pax_tar[offset:offset + 512])
    pax_tar[offset + 148:offset + 156] = ('%06o\x00 ' % checksum).encode()
    write('pax-overrides.tar.gz', gzip.compress(pax_tar, mtime=0))
    pax_result = invoke(sys.executable, 'verify-package', ROOT / 'pax-overrides.tar.gz')
    assert pax_result['status'] == 'passed', pax_result
    samples = []

    def sample(name, data, basis, reason, required_status='failed'):
        path = 'corrupt/' + name + '.tar.gz'
        write(path, data)
        result = invoke(sys.executable, 'verify-package', ROOT / path)
        samples.append({'name': name, 'path': path, 'construction': basis,
                        'requiredStatus': required_status, 'requiredReason': reason, 'legacyResult': result})

    for name in ['missing', 'extra', 'duplicate', 'size', 'digest', 'manifest', 'index']:
        changed = []
        for m, data in items:
            m = m.replace()
            if name == 'missing' and m.name == 'src.ts':
                continue
            if name == 'size' and m.name == 'src.ts':
                data += b'x'
            if name == 'digest' and m.name == 'src.ts':
                data = b'x' * len(data)
            if name == 'manifest' and m.name == 'production.json':
                data = data.replace(b'"fps":10', b'"fps":11')
            if name == 'index' and m.name == legacy.INDEX:
                data = data.replace(b'"schemaVersion": 1', b'"schemaVersion": 2')
            m.size = len(data)
            changed.append((m, data))
        if name == 'extra':
            m = tarfile.TarInfo('unexpected.txt'); m.size = 1
            changed.append((m, b'x'))
        if name == 'duplicate':
            changed.append(next((m, d) for m, d in items if m.name == 'src.ts'))
        sample(name, repack(changed), '旧 tarfile 重写原成员，只改变 ' + name,
               {'missing': '缺失成员', 'extra': '额外成员', 'duplicate': '重复成员'}.get(name, '内容摘要或大小不符'))
    sample('invalid-header', gzip.compress(b'x' * 512 + tar[512:], mtime=0), '首个文件头替换为非零无效块', '文件头损坏')
    sample('header-truncated', gzip.compress(tar[:255], mtime=0), '首文件头只保留 255 字节', '文件头截断')
    first = items[0][0]
    sample('body-truncated', gzip.compress(tar[:first.offset_data + first.size - 1], mtime=0), '索引正文删除最后字节及后续流', '成员正文截断')
    compressed = bytearray(good.read_bytes()); compressed[-8] ^= 255
    sample('gzip-crc', bytes(compressed), '翻转 gzip CRC 尾字段', 'gzip 完整性损坏')
    compressed = bytearray(good.read_bytes()); compressed[-4] ^= 255
    sample('gzip-length', bytes(compressed), '翻转 gzip ISIZE 尾字段', 'gzip 长度校验损坏')
    sample('gzip-truncated', good.read_bytes()[:-9], 'gzip 删除尾部 9 字节', 'gzip 截断')
    sample('missing-end-blocks', gzip.compress(tar[:end], mtime=0), '最后正文对齐之后移除所有结束零块', '双结束零块缺失')
    sample('single-end-block', gzip.compress(tar[:end] + bytes(512), mtime=0), '仅保留一个结束零块', '第二个结束零块缺失')
    sample('bad-header-at-end', gzip.compress(tar[:end] + b'x' * 512 + tar[end:], mtime=0), '结束之前插入损坏文件头', '结束块损坏')
    sample('nonzero-tar-tail', gzip.compress(tar + b'x' * 512, mtime=0), 'tar 结束零块之后追加非零数据', '结束后存在非零数据')
    # tarfile 对无效 PAX 长度存在容错；保存原观察，规格仍要求拒绝。
    pax_offset = next(m.offset for m, _ in items if m.pax_headers)
    bad_pax = bytearray(tar); bad_pax[pax_offset + 512] = ord('x')
    sample('malformed-pax', gzip.compress(bad_pax, mtime=0), '局部 PAX 首条记录长度首字符改为 x（保持物理块大小）', 'PAX 记录长度损坏')
    sample('compressed-nonzero-tail', good.read_bytes() + b'junk', '完整 gzip 流之后追加非零原始字节', '压缩流尾部损坏')
    sample('compressed-zero-tail', good.read_bytes() + bytes(32), '完整 gzip 流之后追加 32 个原始零字节', '沿用旧 gzip 的零尾容错，完整流均须校验', 'passed')
    sample('compressed-zero-then-junk', good.read_bytes() + bytes(32) + b'junk', 'gzip 零尾之后追加非零垃圾，不得在首零处停止校验', '压缩流尾部损坏')
    sample('compressed-zero-then-gzip', good.read_bytes() + bytes(32) + gzip.compress(bytes(1024), mtime=0), 'gzip 零尾之后追加有效仅含零明文的第二流', '沿用旧行为，零尾不能掩盖后续完整 gzip 流', 'passed')
    sample('concatenated-empty-gzip', good.read_bytes() + gzip.compress(b'', mtime=0), '追加第二个空 gzip 流', '沿用旧行为，全部连续 gzip 流均须校验', 'passed')
    sample('concatenated-zero-gzip', good.read_bytes() + gzip.compress(bytes(1024), mtime=0), '追加第二个仅含零明文的 gzip 流', '连续流明文是合法 tar 零尾，全部 gzip 流均须校验', 'passed')
    sample('concatenated-nonzero-gzip', good.read_bytes() + gzip.compress(b'not-zero', mtime=0), '追加第二个含非零明文的完整 gzip 流', 'tar 结束后非零数据')
    second = bytearray(gzip.compress(bytes(1024), mtime=0)); second[-8] ^= 255
    sample('concatenated-crc', good.read_bytes() + second, '第二个 gzip 流 CRC 损坏，明文仅含零', '连续压缩流完整性损坏')
    sample('compressed-zero-then-crc', good.read_bytes() + bytes(32) + second, 'gzip 零尾之后追加 CRC 损坏的第二流', '零尾之后的连续压缩流完整性损坏')
    environments = [{'version': sys.version, 'platform': platform.platform(), 'executable': sys.executable,
                     'role': '本机对照版本', 'status': 'verified'}]
    comparison = {'minimumDeclared': '3.12', 'status': 'unverified', 'reason': '未提供可执行的 Python 3.12 环境'}
    if args.compare_python:
        python = args.compare_python
        info = json.loads(subprocess.check_output([python, '-c', 'import json,sys,platform;print(json.dumps({"version":sys.version,"platform":platform.platform(),"executable":sys.executable}))'], text=True))
        results = []
        for relative in ['valid.tar.gz', 'pax-overrides.tar.gz'] + [x['path'] for x in samples]:
            results.append({'path': relative, 'result': invoke(python, 'verify-package', ROOT / relative)})
        code = 'import importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location("old",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.entries(Path(sys.argv[2]),Path(sys.argv[2])/"production.json")[1].hex())'
        other_index = bytes.fromhex(subprocess.check_output([python, '-B', '-c', code, str(LEGACY), str(ROOT / 'project')], text=True).strip())
        assert other_index == index, '最低版本与本机索引字节存在差异'
        other_archive = ROOT / 'valid-python-3.12.tar.gz'
        other_pack = invoke(python, 'pack', other_archive)
        assert other_pack['status'] == 'passed', other_pack
        local_verify_other = invoke(sys.executable, 'verify-package', other_archive)
        assert local_verify_other['status'] == 'passed', local_verify_other
        environments.append({**info, 'role': '最低声明版本', 'status': 'verified'})
        comparison = {'minimumDeclared': '3.12', 'status': 'verified', 'indexBytesEqual': True, 'results': results,
                      'minimumGeneratedArchive': 'valid-python-3.12.tar.gz', 'minimumPackResult': other_pack,
                      'localVerifyMinimumResult': local_verify_other,
                      'scope': '同一冻结清单与固定归档；不泛化至其他 Python 版本或平台'}
    identities = []
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and (path.name.endswith('.tar.gz') or 'project' in path.relative_to(ROOT).parts or path.name == 'expected-index.json' or path == LEGACY):
            data = path.read_bytes()
            identities.append({'path': path.relative_to(ROOT).as_posix(), 'size': len(data), 'sha256': sha(data)})
    catalog = {'source': {'commit': SOURCE_COMMIT, 'path': 'scripts/production/archive.py',
                          'snapshot': 'legacy/archive.py', 'sha256': sha(LEGACY.read_bytes()),
                          'generatorSha256': sha(Path(__file__).read_bytes()),
                          'command': ' '.join(sys.argv), 'cwd': str(Path.cwd())},
               'environments': environments, 'comparison': comparison, 'identities': identities,
               'success': {'path': 'valid.tar.gz', 'legacyPackResult': packed, 'legacyResult': verified,
                           'members': [{'path': n, **value} for n, value in members.items()]},
               'paxSuccess': {'path': 'pax-overrides.tar.gz', 'legacyResult': pax_result,
                              'effectiveFields': ['path', 'size', 'uid', 'gid', 'uname', 'gname', 'mtime']},
               'corrupt': samples}
    write('catalog.json', (json.dumps(catalog, ensure_ascii=False, indent=2) + '\n').encode())
    print(json.dumps({'status': 'generated', 'successMembers': len(members), 'corrupt': len(samples), 'comparison': comparison['status']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
