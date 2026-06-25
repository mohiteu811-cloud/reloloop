import Replicate from 'replicate';

export const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN ?? '',
});

// CLIP image-encoder model. Defaults to andreasjansson/clip-features
// which returns 768-dim ViT-L/14 embeddings. Pinning to a specific
// version hash is best practice for reproducibility — set
// REPLICATE_CLIP_MODEL to `owner/name:hash` in env to override.
export const CLIP_MODEL = (
  process.env.REPLICATE_CLIP_MODEL ?? 'andreasjansson/clip-features'
) as `${string}/${string}` | `${string}/${string}:${string}`;

// pgvector column is vector(768) per reloloop-schema.md §2.2. The
// vector we persist must match this dimension exactly. CLIP ViT-L/14
// image embeddings are 768-dim, which is why that model is the
// default. If you swap to ViT-B/32 (512-dim) the schema needs to
// change with it.
export const EMBEDDING_DIM = 768;

// Replicate's andreasjansson/clip-features model takes a
// pipe-delimited list of image URLs and returns an array of
// { input, embedding } objects (one per URL). Other CLIP models
// have different input/output shapes — if you change
// REPLICATE_CLIP_MODEL, you may need to change this adapter too.
export async function embedImages(urls: string[]): Promise<number[][]> {
  if (urls.length === 0) return [];
  const output = await replicate.run(CLIP_MODEL, {
    input: { inputs: urls.join('|') },
  });
  if (!Array.isArray(output)) {
    throw new Error(
      `clip output not an array: ${typeof output} ${JSON.stringify(output).slice(0, 200)}`,
    );
  }
  return output.map((item, i) => {
    const embedding = (item as { embedding?: unknown }).embedding;
    if (!Array.isArray(embedding)) {
      throw new Error(`clip output[${i}] missing embedding array`);
    }
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `clip output[${i}] dim mismatch: expected ${EMBEDDING_DIM}, got ${embedding.length}`,
      );
    }
    return embedding as number[];
  });
}

// Average vectors element-wise. Pre-condition: all input vectors
// share the same length (we verify EMBEDDING_DIM in embedImages).
export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('meanPool: empty vectors');
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return sum;
}

// L2-normalize so cosine similarity = dot product. pgvector's <=>
// operator returns cosine DISTANCE (1 - cosine similarity), so
// normalizing isn't strictly necessary for the operator's correctness,
// but it stabilises numerical behaviour and matches what the schema
// doc §3.1 step 5 specifies.
export function l2Normalize(v: number[]): number[] {
  let sumsq = 0;
  for (const x of v) sumsq += x * x;
  const norm = Math.sqrt(sumsq);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}
