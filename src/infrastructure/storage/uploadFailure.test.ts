import { describeUploadFailure } from './uploadFailure';

describe('describeUploadFailure', () => {
  const gatewayHtml = [
    '<html>',
    '<head><title>502 Bad Gateway</title></head>',
    '<body>',
    '<center><h1>502 Bad Gateway</h1></center>',
    '<hr><center>nginx</center>',
    '</body>',
    '</html>',
  ].join('\n');

  it('summarises an HTML error page instead of quoting the markup (issue #177)', () => {
    expect(describeUploadFailure(gatewayHtml)).toBe('502 Bad Gateway 502 Bad Gateway nginx');
  });

  it('drops script and style contents from an HTML page', () => {
    const page = '<html><head><style>h1{color:red}</style><script>var a=1;</script></head><body>Gone</body></html>';
    expect(describeUploadFailure(page)).toBe('Gone');
  });

  it('reports the message from a Cloudinary JSON error', () => {
    expect(describeUploadFailure(JSON.stringify({ error: { message: 'File size too large' } })))
      .toBe('File size too large');
  });

  it('passes a plain-text body through unchanged', () => {
    expect(describeUploadFailure('File size too large')).toBe('File size too large');
  });

  it('collapses newlines and runs of whitespace onto one line', () => {
    expect(describeUploadFailure('upstream\n  connect   error\n')).toBe('upstream connect error');
  });

  it('truncates a long body so one error cannot flood the report', () => {
    expect(describeUploadFailure('x'.repeat(500))).toBe(`${'x'.repeat(200)}…`);
  });

  it('names an empty body rather than trailing an empty colon', () => {
    expect(describeUploadFailure('   \n  ')).toBe('no response body');
  });

  it('names a body that is nothing but markup', () => {
    expect(describeUploadFailure('<html><body><img src="x"></body></html>')).toBe('no response body');
  });
});
