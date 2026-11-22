import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordMenuAdminAuditEvent } from "./record-menu-admin-audit-event";

const rpcMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

const client = { rpc: rpcMock, from: fromMock } as unknown as SupabaseClient;

const input = {
  tenantId: "tenant-1",
  actorUserId: "user-1",
  action: "dish.updated",
  targetType: "dish",
  targetId: "dish-1",
  metadata: { field: "name" },
};

describe("recordMenuAdminAuditEvent", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpcMock.mockReset();
    insertMock.mockReset();
    fromMock.mockClear();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("writes through record_audit_event() and does not touch the table", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await recordMenuAdminAuditEvent(client, input);

    expect(rpcMock).toHaveBeenCalledWith("record_audit_event", {
      p_tenant_id: "tenant-1",
      p_action: "dish.updated",
      p_target_type: "dish",
      p_target_id: "dish-1",
      p_metadata: { field: "name" },
    });
    expect(fromMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])(
    "falls back to the direct insert when the RPC does not exist (%s)",
    async (code) => {
      rpcMock.mockResolvedValue({ data: null, error: { code, message: "missing" } });
      insertMock.mockResolvedValue({ error: null });

      await recordMenuAdminAuditEvent(client, input);

      expect(fromMock).toHaveBeenCalledWith("audit_logs");
      expect(insertMock).toHaveBeenCalledWith({
        tenant_id: "tenant-1",
        actor_user_id: "user-1",
        action: "dish.updated",
        target_type: "dish",
        target_id: "dish-1",
        metadata: { field: "name" },
      });
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("logs but does not fall back or throw on any other RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });

    await expect(recordMenuAdminAuditEvent(client, input)).resolves.toBeUndefined();

    expect(fromMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("never throws when the fallback insert fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    insertMock.mockResolvedValue({ error: { message: "boom" } });

    await expect(recordMenuAdminAuditEvent(client, input)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
  });
});
