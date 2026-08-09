import { missingVars, setupMessage, type EnvVar } from './env';

const varOf = (name: string, value: string | undefined, source = 'somewhere'): EnvVar =>
  ({ name, source, value });

describe('missingVars', () => {
  it('returns nothing when every variable has a value', () => {
    expect(missingVars([varOf('A', 'a'), varOf('B', 'b')])).toEqual([]);
  });

  it('collects every missing variable, not just the first', () => {
    const missing = missingVars([varOf('A', undefined), varOf('B', 'b'), varOf('C', undefined)]);

    expect(missing.map(v => v.name)).toEqual(['A', 'C']);
  });

  it('treats an empty or blank value as missing', () => {
    // A placeholder line left as `KEY=` in .env reads as '' at runtime, which
    // fails deep inside a request instead of here where we can name it.
    expect(missingVars([varOf('A', ''), varOf('B', '   ')]).map(v => v.name)).toEqual(['A', 'B']);
  });
});

describe('setupMessage', () => {
  const message = setupMessage([
    varOf('EXPO_PUBLIC_SUPABASE_URL', undefined, 'Supabase → Project Settings → API'),
    varOf('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME', undefined, 'Cloudinary dashboard'),
  ]);

  it('names every missing variable', () => {
    expect(message).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(message).toContain('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME');
  });

  it('says where each one comes from, so the reader knows which account to open', () => {
    expect(message).toContain('Supabase → Project Settings → API');
    expect(message).toContain('Cloudinary dashboard');
  });

  it('points at the setup instructions', () => {
    expect(message).toContain('.env.example');
    expect(message).toContain('Getting started');
  });

  it('counts in the plural only when there is more than one', () => {
    expect(message).toContain('2 required variables are missing');
    expect(setupMessage([varOf('ONE', undefined)])).toContain('1 required variable is missing');
  });
});
