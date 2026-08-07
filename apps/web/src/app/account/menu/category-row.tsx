"use client";

import { useActionState } from "react";
import {
  archiveCategoryAction,
  moveCategoryAction,
  renameCategoryAction,
  type MenuActionState,
} from "./actions";

const initialState: MenuActionState = {};

export function CategoryRow({ id, name }: { id: string; name: string }) {
  const [renameState, renameFormAction, renamePending] = useActionState(
    renameCategoryAction,
    initialState,
  );
  const [moveState, moveFormAction] = useActionState(moveCategoryAction, initialState);
  const [archiveState, archiveFormAction] = useActionState(archiveCategoryAction, initialState);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <form action={renameFormAction} className="flex items-center gap-2">
        <input type="hidden" name="categoryId" value={id} />
        <label htmlFor={`category-name-${id}`} className="sr-only">
          Kategoriename
        </label>
        <input
          id={`category-name-${id}`}
          name="name"
          defaultValue={name}
          className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
        <button
          type="submit"
          disabled={renamePending}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm font-medium text-foreground"
        >
          Umbenennen
        </button>
      </form>

      <form action={moveFormAction}>
        <input type="hidden" name="categoryId" value={id} />
        <input type="hidden" name="direction" value="up" />
        <button
          type="submit"
          aria-label={`${name} nach oben verschieben`}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
        >
          ↑
        </button>
      </form>
      <form action={moveFormAction}>
        <input type="hidden" name="categoryId" value={id} />
        <input type="hidden" name="direction" value="down" />
        <button
          type="submit"
          aria-label={`${name} nach unten verschieben`}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
        >
          ↓
        </button>
      </form>

      <form action={archiveFormAction}>
        <input type="hidden" name="categoryId" value={id} />
        <button
          type="submit"
          className="rounded-md border border-danger-500 px-2 py-1 text-sm text-danger-600"
        >
          Archivieren
        </button>
      </form>

      {renameState.error ? (
        <span role="alert" className="w-full text-sm text-danger-600">
          {renameState.error}
        </span>
      ) : null}
      {moveState.error ? (
        <span role="alert" className="w-full text-sm text-danger-600">
          {moveState.error}
        </span>
      ) : null}
      {archiveState.error ? (
        <span role="alert" className="w-full text-sm text-danger-600">
          {archiveState.error}
        </span>
      ) : null}
    </div>
  );
}
