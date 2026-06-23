/**
 * Mock profile for the Me page.
 *
 * There is no publisher profile model yet (the app only knows `publisherId` /
 * `publisherPhone`). Real name / bio / avatar storage and a live followers
 * count are tracked in issue #37 — until then the Me page renders this rich
 * mock so the screen looks fully populated.
 */
export const profileStub = {
  name: 'Uri Shiber',
  bio: 'Sharing my favorite moments with the people who matter. New photos from the road every week.',
  avatarUri: 'https://i.pravatar.cc/300?img=12',
  countries: 4,
  followers: 128,
};
