import { displaySizedUri } from './cloudinaryDelivery';

describe('displaySizedUri', () => {
  it('inserts the resize transform after /upload/', () => {
    expect(displaySizedUri('https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 1080)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_1080,c_limit,f_auto,q_auto/v1/a.jpg',
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
