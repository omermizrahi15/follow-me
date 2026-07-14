import { parseSong } from './Song';

const validSong = {
  title: 'Vienna',
  artist: 'Billy Joel',
  artworkUrl: 'https://cdn.example.com/art.jpg',
  previewUrl: 'https://cdn.example.com/preview.m4a',
  sourceUrl: 'https://music.example.com/vienna',
};

describe('parseSong', () => {
  it('accepts a full song', () => {
    expect(parseSong(validSong)).toEqual(validSong);
  });

  it('accepts a minimal song of just title and artist', () => {
    expect(parseSong({ title: 'Vienna', artist: 'Billy Joel' }))
      .toEqual({ title: 'Vienna', artist: 'Billy Joel' });
  });

  it('drops optional fields that are not strings', () => {
    const parsed = parseSong({ ...validSong, artworkUrl: 42, previewUrl: null });
    expect(parsed).toEqual({
      title: 'Vienna',
      artist: 'Billy Joel',
      sourceUrl: validSong.sourceUrl,
    });
  });

  it('rejects a missing or empty title', () => {
    expect(parseSong({ artist: 'Billy Joel' })).toBeNull();
    expect(parseSong({ title: '  ', artist: 'Billy Joel' })).toBeNull();
  });

  it('rejects a missing or empty artist', () => {
    expect(parseSong({ title: 'Vienna' })).toBeNull();
    expect(parseSong({ title: 'Vienna', artist: '' })).toBeNull();
  });

  it('rejects non-object values', () => {
    expect(parseSong(null)).toBeNull();
    expect(parseSong(undefined)).toBeNull();
    expect(parseSong('Vienna')).toBeNull();
    expect(parseSong(['Vienna'])).toBeNull();
  });
});
