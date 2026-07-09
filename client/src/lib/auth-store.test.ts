import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@shared/auth";

import { useAuthStore } from "./auth-store";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const user: CurrentUser = {
  id: "user-1",
  email: "user@example.com",
  displayName: "User One",
  avatarUrl: null,
  role: "user",
  status: "active",
  emailVerified: false,
  createdAt: "2026-04-30T00:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("auth-store", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useAuthStore.getState().resetForTest();
  });

  it("restores the current user from /api/auth/me", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, user }));

    await useAuthStore.getState().fetchMe();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", {
      credentials: "include",
    });
    expect(useAuthStore.getState().currentUser).toEqual(user);
    expect(useAuthStore.getState().sessionChecked).toBe(true);
    expect(useAuthStore.getState().isAuthenticated()).toBe(true);
  });

  it("clears the user without surfacing an error for a missing session", async () => {
    useAuthStore.setState({ currentUser: user });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Authentication required" }, 401)
    );

    await useAuthStore.getState().fetchMe();

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().sessionChecked).toBe(true);
  });

  it("posts login credentials and stores the returned user", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, user }));

    const ok = await useAuthStore.getState().login({
      email: "  USER@Example.COM ",
      password: "password123",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "password123",
        }),
      })
    );
    expect(useAuthStore.getState().currentUser?.id).toBe("user-1");
  });

  it("returns false and records the server error when login fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Email or password is invalid" }, 401)
    );

    const ok = await useAuthStore.getState().login({
      email: "user@example.com",
      password: "wrong-password",
    });

    expect(ok).toBe(false);
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().error).toBe("Email or password is invalid");
  });

  it("requests an email login code with normalized email", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, expiresInSeconds: 600 }));

    const ok = await useAuthStore.getState().sendEmailLoginCode({
      email: "  USER@Example.COM ",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/email-code/send",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
        }),
      })
    );
    expect(useAuthStore.getState().error).toBeNull();
  });

  it("logs in with an email code and stores the returned user", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, user }));

    const ok = await useAuthStore.getState().loginWithEmailCode({
      email: "USER@example.com",
      code: " 123456 ",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/email-code/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "user@example.com",
          code: "123456",
        }),
      })
    );
    expect(useAuthStore.getState().currentUser).toEqual(user);
  });

  it("records the server error when email code login fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Email or code is invalid." }, 401)
    );

    const ok = await useAuthStore.getState().loginWithEmailCode({
      email: "user@example.com",
      code: "000000",
    });

    expect(ok).toBe(false);
    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(useAuthStore.getState().error).toBe("Email or code is invalid.");
  });

  it("registers a user and keeps the session user in state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, user }, 201));

    const ok = await useAuthStore.getState().register({
      email: "new@example.com",
      password: "password123",
      displayName: "New User",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "new@example.com",
          password: "password123",
          displayName: "New User",
        }),
      })
    );
    expect(useAuthStore.getState().currentUser).toEqual(user);
  });

  it("clears the current user on logout", async () => {
    useAuthStore.setState({ currentUser: user });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    await useAuthStore.getState().logout();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    expect(useAuthStore.getState().currentUser).toBeNull();
  });

  it("derives admin status from the shared role contract", () => {
    expect(useAuthStore.getState().isAdmin()).toBe(false);

    useAuthStore.setState({
      currentUser: { ...user, role: "admin" },
    });
    expect(useAuthStore.getState().isAdmin()).toBe(true);

    useAuthStore.setState({
      currentUser: { ...user, role: "super_admin" },
    });
    expect(useAuthStore.getState().isAdmin()).toBe(true);
  });
});
