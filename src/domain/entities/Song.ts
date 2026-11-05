/** A song a publisher attached to a post, picked from a catalog search. */
export interface Song {
  title: string;
  artist: string;
  artworkUrl?: string;
  /** Short audio clip the composer plays while the post is being previewed. */
  previewUrl?: string;
}
