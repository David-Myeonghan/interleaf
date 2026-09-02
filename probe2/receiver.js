window.addEventListener('message', async (event) => {
  if (!event.data || event.data.__xfer !== 'handle') return;
  const handle = event.data.handle;
  const report = {
    __xfer: 'report',
    hasHandle: !!handle,
    isDirHandle: !!(handle && typeof handle.getFileHandle === 'function'),
    name: handle && handle.name,
    kind: handle && handle.kind,
  };
  if (report.isDirHandle) {
    try {
      report.permission = await handle.queryPermission({ mode: 'readwrite' });
      const fh = await handle.getFileHandle('xfer-write.txt', { create: true });
      const w = await fh.createWritable();
      await w.write('written after transfer');
      await w.close();
      report.canWrite = true;
    } catch (e) {
      report.canWrite = e.name + ': ' + e.message;
    }
  }
  document.getElementById('out').textContent = JSON.stringify(report, null, 2);
  if (window.opener) window.opener.postMessage(report, '*');
});
