// Deterministic (not model-dependent) detector for "generate/draw/create an
// image of X" style requests typed straight into normal Chat. Sibling to
// detectWhoIsRequest.ts/detectAssistanceRequest.ts/detectSiteBuildRequest.ts,
// same shape, different intent.
//
// Deliberately requires an explicit CREATION verb (generate/create/make/
// draw/paint/design) paired with an image-shaped noun — "show me a photo
// of Paris" or "find pictures of the Eiffel Tower" is the "Real images for
// topics" capability's turf (a real web search for an EXISTING photo, not
// a new generated one), not this.

const IMAGE_GEN_INTENT =
  /\b(generate|create|make|draw|paint|design)\b[^.!?]{0,40}\b(image|picture|photo|illustration|artwork|drawing|painting|graphic|logo|icon|wallpaper|avatar)\b/i;

export function detectImageGenerationRequest(text: string): boolean {
  // Backs off from other detectors' own turf — a "build me a website with a
  // logo" request is Smart Build's, not a standalone image generation.
  if (/\b(website|web\s*site|webpage|app|application|agent)\b/i.test(text)) return false;
  return IMAGE_GEN_INTENT.test(text);
}
