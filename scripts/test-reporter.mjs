/** 与 TAP 同时消费原生测试事件，避免从终端尾部或正则日志推测失败。 */
export default async function* report(source) {
  const failures = []; let summary;
  for await (const { type, data } of source) {
    if (type === 'test:fail' && data.details?.error?.failureType !== 'subtestsFailed') {
      failures.push({ file: data.file, name: data.name, line: data.line, column: data.column,
        message: String(data.details?.error?.cause?.message ?? data.details?.error?.message ?? '测试失败') });
    }
    if (type === 'test:summary') summary = data;
  }
  yield JSON.stringify({ schemaVersion: 1, complete: !!summary, failures, summary }, null, 2) + '\n';
}
