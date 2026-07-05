import { displaySizedUri, videoPosterUri } from './cloudinaryDelivery';

describe('videoPosterUri', () => {
  it('swaps a video extension to .jpg for the poster frame', () => {
    expect(videoPosterUri('https://res.cloudinary.com/demo/video/upload/v1/a.mp4')).toBe(
      'https://res.cloudinary.com/demo/video/upload/v1/a.jpg',
    );
  });

  it('leaves non-Cloudinary URLs untouched', () => {
    expect(videoPosterUri('https://example.com/clip.mp4')).toBe('https://example.com/clip.mp4');
  });
});

describe('displaySizedUri', () => {
  it('inserts the resize transform after /upload/', () => {
    expect(displaySizedUri('https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 1080)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_1080,c_limit,f_auto,q_auto/v1/a.jpg',
    );
  });

  it('also transforms video-derived poster URLs', () => {
    expect(displaySizedUri('https://res.cloudinary.com/demo/video/upload/v1/a.jpg', 720)).toBe(
      'https://res.cloudinary.com/demo/video/upload/w_720,c_limit,f_auto,q_auto/v1/a.jpg',
    );
  });

  it('leaves non-Cloudinary URLs untouched', () => {
    expect(displaySizedUri('https://picsum.photos/seed/x/900/1100', 1080)).toBe(
      'https://picsum.photos/seed/x/900/1100',
    );
  });

  it('leaves Cloudinary URLs without an upload segment untouched', () => {
    expect(displaySizedUri('https://res.cloudinary.com/demo/other/v1/a.jpg', 1080)).toBe(
      'https://res.cloudinary.com/demo/other/v1/a.jpg',
    );
  });
});
