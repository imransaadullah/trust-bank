Redoc.init('/openapi.yaml', {
  hideDownloadButton: false,
  expandResponses: '200,201',
  theme: {
    colors: {
      primary: { main: '#93641f' },
    },
    typography: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      code: { fontFamily: '"SF Mono", ui-monospace, "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace' },
      headings: { fontFamily: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif' },
    },
  },
}, document.getElementById('redoc-container'), function () {
  document.getElementById('redoc-loading').remove();
});
