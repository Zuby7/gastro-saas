"use client";

import { useActionState } from "react";
import { uploadDishImageAction, type DishActionState } from "./actions";

const initialState: DishActionState = {};

export function ImageUploadForm({
  dishId,
  currentImageUrl,
  currentAltText,
}: {
  dishId: string;
  currentImageUrl: string | null;
  currentAltText: string | null;
}) {
  const [state, formAction, isPending] = useActionState(uploadDishImageAction, initialState);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Bild</h2>

      {currentImageUrl ? (
        <img
          src={currentImageUrl}
          alt={currentAltText ?? ""}
          className="h-32 w-32 rounded-md object-cover"
        />
      ) : (
        <p className="text-sm text-foreground-secondary">Noch kein Bild hochgeladen.</p>
      )}

      {state.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-success-600">
          {state.success}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="dishId" value={dishId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="dish-image-file" className="text-sm font-medium text-foreground">
            Bilddatei (JPEG/PNG/WebP, max. 5 MB)
          </label>
          <input
            id="dish-image-file"
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            className="text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dish-image-alt" className="text-sm font-medium text-foreground">
            Alt-Text (Pflichtfeld)
          </label>
          <input
            id="dish-image-alt"
            name="altText"
            required
            defaultValue={currentAltText ?? ""}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Wird hochgeladen…" : "Bild hochladen"}
        </button>
      </form>
    </section>
  );
}
