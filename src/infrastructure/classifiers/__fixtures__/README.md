# Photo classification fixtures

Sample images used by `GeminiPhotoClassifier.integration.test.ts` to verify the AI
labels real photos into the right rule category.

## How to activate the integration test

1. Add one clear example photo per rule into this folder, e.g.:
   - `selfie_with_view.jpg` — a selfie with a scenic background
   - `selfie_with_people.jpg` — a group selfie / people-focused selfie
   - `nature.jpg` — a natural scene (forest, beach, wildlife) with no people
   - `food.jpg` — a dish or drink
   You can add several per category and edge cases (a blurry shot, a screenshot →
   `other`) to probe the model.

2. Copy `manifest.example.json` to `manifest.json` and list your files with their
   expected category (`selfie_with_view` | `selfie_with_people` | `nature` | `food` | `other`).

3. Deploy the function and export its URL + your Supabase anon key:
   ```sh
   export CLASSIFY_FN_URL="https://<project>.functions.supabase.co/classify-photos"
   export CLASSIFY_FN_KEY="<supabase anon key>"
   npm run test:integration
   ```

The test prints what the model returned for each image (category, confidence,
quality, caption) so you can eyeball the results, and fails if a category is wrong.

> `manifest.json` and the image files are git-ignored — they're your local samples.
