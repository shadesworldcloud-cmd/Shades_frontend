import { useCallback, useEffect, useState } from "react";
import { getStorefrontSettings } from "../services/api";

/**
 * Administrator-uploaded collection photographs, resolved by collection name.
 *
 * Shared by the home page showcase and the /collections tiles because both render the same four
 * collections from the same setting. Two copies of this fetch would be two places to get the
 * "blank means reverted" rule wrong, which is exactly the bug the hero image had to have fixed
 * once already.
 *
 * It starts empty and never blocks a render: the caller falls back to its bundled asset, so a slow
 * or failing settings call shows the built-in photograph rather than an empty frame. Same reasoning
 * as Hero, which paints the bundled banner immediately and swaps only once a URL actually arrives.
 *
 * There is no onError fallback of the kind Hero has, because these are CSS background-images and a
 * background has no error event. A configured URL that 404s therefore shows the card's `tone` — the
 * flat colour painted underneath for exactly this case — rather than a broken-image icon.
 *
 * @returns {(collection: string) => string|null} the configured URL, or null to use the bundled one
 */
export default function useCollectionImages() {
  const [images, setImages] = useState({});

  useEffect(() => {
    let active = true;
    getStorefrontSettings()
      .then((settings) => {
        if (active && settings?.collectionImageUrls) setImages(settings.collectionImageUrls);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  // The server omits a reverted collection rather than sending an empty string, but a blank is
  // still guarded here: the hero setting stores "" for the same state, and a client that cannot
  // tell the two conventions apart would render url("") and lose the photograph entirely.
  return useCallback((collection) => {
    const url = images[collection];
    return url && url.trim() ? url.trim() : null;
  }, [images]);
}
