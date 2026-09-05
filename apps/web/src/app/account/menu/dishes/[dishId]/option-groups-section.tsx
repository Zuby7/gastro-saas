"use client";

import { useActionState } from "react";
import {
  assignOptionGroupAction,
  createOptionAction,
  createOptionGroupAction,
  setOptionAvailabilityAction,
  unassignOptionGroupAction,
  type DishActionState,
} from "./actions";
import { AvailabilityToggleForm } from "./availability-toggle-form";

const initialState: DishActionState = {};

export interface OptionRecord {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
  available_again_at: string | null;
}

export interface OptionGroupRecord {
  id: string;
  name: string;
  min_selections: number;
  max_selections: number;
  options: OptionRecord[];
}

export interface OptionGroupsSectionProps {
  dishId: string;
  allOptionGroups: OptionGroupRecord[];
  assignedGroupIds: string[];
  canEditMenu: boolean;
  canManageAvailability: boolean;
}

export function OptionGroupsSection({
  dishId,
  allOptionGroups,
  assignedGroupIds,
  canEditMenu,
  canManageAvailability,
}: OptionGroupsSectionProps) {
  const [assignState, assignFormAction] = useActionState(assignOptionGroupAction, initialState);
  const [unassignState, unassignFormAction] = useActionState(
    unassignOptionGroupAction,
    initialState,
  );
  const [createGroupState, createGroupFormAction, isCreateGroupPending] = useActionState(
    createOptionGroupAction,
    initialState,
  );
  const [createOptionState, createOptionFormAction, isCreateOptionPending] = useActionState(
    createOptionAction,
    initialState,
  );

  const assignedGroups = allOptionGroups.filter((group) => assignedGroupIds.includes(group.id));
  const unassignedGroups = allOptionGroups.filter((group) => !assignedGroupIds.includes(group.id));

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Optionsgruppen &amp; Extras</h2>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-foreground">Zugewiesen</h3>
        {assignedGroups.length === 0 ? (
          <p className="text-sm text-foreground-secondary">Noch keine Optionsgruppen zugewiesen.</p>
        ) : null}
        {assignedGroups.map((group) => (
          <div key={group.id} className="rounded-md border border-neutral-300 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {group.name} (Min {group.min_selections} / Max {group.max_selections})
              </span>
              {canEditMenu ? (
                <form action={unassignFormAction}>
                  <input type="hidden" name="dishId" value={dishId} />
                  <input type="hidden" name="optionGroupId" value={group.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-danger-500 px-2 py-1 text-sm text-danger-foreground"
                  >
                    Entfernen
                  </button>
                </form>
              ) : null}
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {group.options.map((option) => (
                <li
                  key={option.id}
                  className="flex flex-col gap-1 rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
                >
                  <span>
                    {option.name}
                    {option.price_delta_cents !== 0
                      ? ` (+${(option.price_delta_cents / 100).toFixed(2)} €)`
                      : ""}
                  </span>
                  {canManageAvailability ? (
                    <AvailabilityToggleForm
                      action={setOptionAvailabilityAction}
                      hiddenFields={{ dishId, optionId: option.id }}
                      isAvailable={option.is_available}
                      availableAgainAt={option.available_again_at}
                      idPrefix={`option-${option.id}`}
                      itemLabel={option.name}
                    />
                  ) : null}
                </li>
              ))}
              {group.options.length === 0 ? (
                <li className="text-sm text-warning-600">
                  Keine Optionen -- blockiert die Veröffentlichung.
                </li>
              ) : null}
            </ul>
          </div>
        ))}
        {assignState.error ? (
          <p role="alert" className="text-sm text-danger-foreground">
            {assignState.error}
          </p>
        ) : null}
        {unassignState.error ? (
          <p role="alert" className="text-sm text-danger-foreground">
            {unassignState.error}
          </p>
        ) : null}
      </div>

      {canEditMenu && unassignedGroups.length > 0 ? (
        <form action={assignFormAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="dishId" value={dishId} />
          <div className="flex flex-col gap-1">
            <label htmlFor="assign-option-group" className="text-sm font-medium text-foreground">
              Bestehende Optionsgruppe zuweisen
            </label>
            <select
              id="assign-option-group"
              name="optionGroupId"
              className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            >
              {unassignedGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-foreground"
          >
            Zuweisen
          </button>
        </form>
      ) : null}

      {canEditMenu ? (
        <form action={createGroupFormAction} className="flex flex-wrap items-end gap-2" noValidate>
          <input type="hidden" name="dishId" value={dishId} />
          <div className="flex flex-col gap-1">
            <label htmlFor="new-group-name" className="text-sm font-medium text-foreground">
              Neue Optionsgruppe
            </label>
            <input
              id="new-group-name"
              name="name"
              required
              className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-group-min" className="text-sm font-medium text-foreground">
              Min
            </label>
            <input
              id="new-group-min"
              name="minSelections"
              type="number"
              min={0}
              defaultValue={0}
              className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-group-max" className="text-sm font-medium text-foreground">
              Max
            </label>
            <input
              id="new-group-max"
              name="maxSelections"
              type="number"
              min={1}
              defaultValue={1}
              className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={isCreateGroupPending}
            className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-neutral-0 disabled:opacity-60"
          >
            {isCreateGroupPending ? "Wird angelegt…" : "Gruppe anlegen"}
          </button>
          {createGroupState.error ? (
            <p role="alert" className="w-full text-sm text-danger-foreground">
              {createGroupState.error}
            </p>
          ) : null}
        </form>
      ) : null}

      {canEditMenu && allOptionGroups.length > 0 ? (
        <form action={createOptionFormAction} className="flex flex-wrap items-end gap-2" noValidate>
          <input type="hidden" name="dishId" value={dishId} />
          <div className="flex flex-col gap-1">
            <label htmlFor="new-option-group" className="text-sm font-medium text-foreground">
              Option zu Gruppe hinzufügen
            </label>
            <select
              id="new-option-group"
              name="optionGroupId"
              className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            >
              {allOptionGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-option-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="new-option-name"
              name="name"
              required
              className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-option-price" className="text-sm font-medium text-foreground">
              Preisaufschlag (Cent)
            </label>
            <input
              id="new-option-price"
              name="priceDeltaCents"
              type="number"
              defaultValue={0}
              className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={isCreateOptionPending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-60"
          >
            {isCreateOptionPending ? "Wird angelegt…" : "Option anlegen"}
          </button>
          {createOptionState.error ? (
            <p role="alert" className="w-full text-sm text-danger-foreground">
              {createOptionState.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
