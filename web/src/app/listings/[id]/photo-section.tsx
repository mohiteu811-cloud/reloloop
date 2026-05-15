'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

export type PhotoSummary = {
  id: string;
  url: string;
  thumbUrl: string | null;
};

// Three-step upload from the schema doc §7.1:
//   1. POST /presign → returns { r2Key, uploadUrl }
//   2. PUT uploadUrl with the file body → lands in R2
//   3. POST /photos with { r2Key, bytes } → creates the Photo row
//      and enqueues photo-postprocess (sharp thumbnail).
//
// Sequential to keep browser memory bounded on big batches.
// Worker handler is internally idempotent so a 3-step retry is
// safe; the upsert on (listingId, r2Key) makes the confirm
// idempotent server-side.
export function PhotoSection({
  listingId,
  photos,
  canEdit,
}: {
  listingId: string;
  photos: PhotoSummary[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function uploadOne(file: File) {
    const tag = `${file.name}-${Date.now()}`;
    setUploading((u) => [...u, tag]);
    try {
      // 1. Presign
      const presignRes = await fetch(
        `/api/listings/${listingId}/photos/presign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentType: file.type,
            sizeBytes: file.size,
          }),
        },
      );
      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => ({}));
        throw new Error(
          `presign ${presignRes.status}: ${body.error ?? 'unknown'}`,
        );
      }
      const { r2Key, uploadUrl } = (await presignRes.json()) as {
        r2Key: string;
        uploadUrl: string;
      };

      // 2. PUT to R2 directly. Browser sends a CORS preflight first;
      // bucket needs a CORS rule allowing PUT from this origin.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`r2 upload ${putRes.status}`);
      }

      // 3. Confirm → creates Photo row + enqueues postprocess.
      const confirmRes = await fetch(`/api/listings/${listingId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r2Key, bytes: file.size }),
      });
      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}));
        throw new Error(
          `confirm ${confirmRes.status}: ${body.error ?? 'unknown'}`,
        );
      }
    } finally {
      setUploading((u) => u.filter((x) => x !== tag));
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow picking the same file again
    for (const file of files) {
      try {
        await uploadOne(file);
      } catch (err) {
        setError(
          `${file.name}: ${err instanceof Error ? err.message : 'failed'}`,
        );
        // Stop the batch on first failure — the user can retry.
        break;
      }
    }
    // Refresh server-side data so newly-created Photo rows show up.
    // Worker fills in thumbUrl/dimensions a moment later — the user
    // can refresh manually to see the thumb, or wait for the next
    // navigation to re-render.
    startTransition(() => router.refresh());
  }

  async function deletePhoto(photoId: string) {
    if (!confirm('Delete this photo?')) return;
    setError(null);
    const res = await fetch(
      `/api/listings/${listingId}/photos/${photoId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(`delete ${res.status}: ${body.error ?? 'unknown'}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>
        Photos
        {photos.length > 0 && (
          <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>
            ({photos.length})
          </span>
        )}
      </h2>

      {photos.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: 6,
                overflow: 'hidden',
                background: '#f5f5f5',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumbUrl ?? p.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {!p.thumbUrl && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 4,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 3,
                  }}
                >
                  Processing…
                </div>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => deletePhoto(p.id)}
                  aria-label="Delete photo"
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 3,
                    padding: '2px 8px',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading.length > 0}
            style={{
              padding: '10px 20px',
              background: uploading.length > 0 ? '#888' : '#111',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: uploading.length > 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
            }}
          >
            {uploading.length > 0
              ? `Uploading (${uploading.length})…`
              : photos.length === 0
                ? 'Add photos'
                : 'Add more'}
          </button>
          <span style={{ fontSize: 12, color: '#888' }}>
            JPEG / PNG / WebP, max 15MB. iPhone HEIC is not supported —
            convert before upload.
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: '#fff4f4',
            border: '1px solid #f99',
            color: '#900',
            borderRadius: 6,
            fontSize: 13,
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </section>
  );
}
