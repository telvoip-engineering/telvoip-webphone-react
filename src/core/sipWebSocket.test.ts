import { describe, expect, test } from "bun:test";
import {
  SIP_CRLF_KEEPALIVE_REQUEST,
  SIP_CRLF_KEEPALIVE_RESPONSE,
  SipKeepaliveSocket,
  type JsSipSocketLike,
  type SipKeepaliveEvent,
} from "./sipWebSocket";

class FakeSocket implements JsSipSocketLike {
  via_transport = "WSS";
  readonly url = "wss://sip.example.test";
  readonly sip_uri = "sip:sip.example.test;transport=ws";
  onconnect = () => undefined;
  ondisconnect: (error: boolean, code?: number, reason?: string) => void = () => undefined;
  ondata: (data: unknown) => void = () => undefined;
  connected = false;
  connecting = false;
  disconnectCalls = 0;
  sendResult = true;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];

  connect(): void {
    this.connecting = true;
  }

  open(): void {
    this.connecting = false;
    this.connected = true;
    this.onconnect();
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.connecting = false;
    this.connected = false;
  }

  close(error = true, code = 1006, reason = ""): void {
    this.connected = false;
    this.ondisconnect(error, code, reason);
  }

  receive(data: unknown): void {
    this.ondata(data);
  }

  send(message: string | ArrayBufferLike | Blob | ArrayBufferView): boolean {
    if (this.sendResult) this.sent.push(message);
    return this.sendResult;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isConnecting(): boolean {
    return this.connecting;
  }
}

class NullableStateSocket extends FakeSocket {
  override isConnected(): boolean {
    return null as unknown as boolean;
  }

  override isConnecting(): boolean {
    return null as unknown as boolean;
  }
}

class ThrowingSendSocket extends FakeSocket {
  override send(): boolean {
    throw new Error("native send failed");
  }
}

const createScheduler = () => {
  let nextId = 1;
  const tasks = new Map<number, () => void>();
  return {
    schedule: (callback: () => void) => {
      const id = nextId++;
      tasks.set(id, callback);
      return id;
    },
    cancel: (handle: unknown) => {
      tasks.delete(handle as number);
    },
    runNext: () => {
      const entry = tasks.entries().next().value as [number, () => void] | undefined;
      if (!entry) throw new Error("No scheduled task");
      tasks.delete(entry[0]);
      entry[1]();
    },
    size: () => tasks.size,
  };
};

describe("SipKeepaliveSocket", () => {
  test("delegates the JsSIP socket contract and forwards SIP data", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    const received: unknown[] = [];
    let connected = 0;
    socket.onconnect = () => {
      connected += 1;
    };
    socket.ondata = (data) => received.push(data);

    socket.connect();
    expect(raw.connecting).toBe(true);
    raw.open();
    raw.receive("SIP/2.0 200 OK\r\n\r\n");

    expect(connected).toBe(1);
    expect(socket.url).toBe(raw.url);
    expect(socket.sip_uri).toBe(raw.sip_uri);
    expect(received).toEqual(["SIP/2.0 200 OK\r\n\r\n"]);
  });

  test("normalizes JsSIP's nullable runtime connection state", () => {
    const socket = new SipKeepaliveSocket(new NullableStateSocket());

    expect(socket.isConnected()).toBe(false);
    expect(socket.isConnecting()).toBe(false);
    expect(socket.getDiagnostics().connected).toBe(false);
  });

  test("sends double CRLF and records a single-CRLF response", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const events: SipKeepaliveEvent[] = [];
    let now = 1_000;
    const socket = new SipKeepaliveSocket(raw, {
      ...scheduler,
      now: () => now,
      onEvent: (event) => events.push(event),
    });
    raw.open();

    expect(socket.sendKeepalive()).toBe(true);
    expect(raw.sent).toEqual([SIP_CRLF_KEEPALIVE_REQUEST]);
    expect(scheduler.size()).toBe(1);

    now = 1_037;
    raw.receive(SIP_CRLF_KEEPALIVE_RESPONSE);

    expect(scheduler.size()).toBe(0);
    expect(socket.getDiagnostics().lastKeepaliveRttMs).toBe(37);
    expect(socket.getDiagnostics().keepaliveResponseSupported).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["sent", "response"]);
  });

  test("normalizes binary CRLF while preserving ordinary binary payloads", () => {
    const raw = new FakeSocket();
    const socket = new SipKeepaliveSocket(raw);
    const received: unknown[] = [];
    socket.ondata = (data) => received.push(data);
    raw.open();

    const pong = new Uint8Array([13, 10]);
    const binarySip = new Uint8Array([83, 73, 80]);
    raw.receive(pong);
    raw.receive(binarySip);

    expect(received[0]).toBe(SIP_CRLF_KEEPALIVE_RESPONSE);
    expect(received[1]).toBe(binarySip);
  });

  test("passes a server double-CRLF ping through for JsSIP to answer", () => {
    const raw = new FakeSocket();
    const socket = new SipKeepaliveSocket(raw);
    const received: unknown[] = [];
    socket.ondata = (data) => received.push(data);
    raw.open();

    raw.receive(SIP_CRLF_KEEPALIVE_REQUEST);

    expect(received).toEqual([SIP_CRLF_KEEPALIVE_REQUEST]);
  });

  test("does not self-disconnect when a server has never demonstrated pong support", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    raw.open();

    socket.sendKeepalive();
    scheduler.runNext();

    expect(raw.disconnectCalls).toBe(0);
    expect(socket.isConnected()).toBe(true);
    expect(socket.getDiagnostics().consecutiveKeepaliveMisses).toBe(1);
  });

  test("hands a confirmed dead flow to JsSIP recovery after two missed pongs", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    const disconnects: Array<{ error: boolean; reason?: string }> = [];
    socket.ondisconnect = (error, _code, reason) => disconnects.push({ error, reason });
    raw.open();

    socket.sendKeepalive();
    raw.receive(SIP_CRLF_KEEPALIVE_RESPONSE);
    socket.sendKeepalive();
    scheduler.runNext();
    socket.sendKeepalive();
    scheduler.runNext();

    expect(raw.disconnectCalls).toBe(1);
    expect(disconnects).toEqual([{ error: true, reason: "SIP CRLF keepalive timeout" }]);
  });

  test("ordinary inbound traffic proves the flow alive and clears a pending deadline", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    raw.open();

    socket.sendKeepalive();
    raw.receive("SIP/2.0 200 OK\r\n\r\n");

    expect(scheduler.size()).toBe(0);
    expect(socket.getDiagnostics().consecutiveKeepaliveMisses).toBe(0);
  });

  test("a send failure produces one synthetic transport failure", () => {
    const raw = new FakeSocket();
    const socket = new SipKeepaliveSocket(raw);
    const disconnects: string[] = [];
    socket.ondisconnect = (_error, _code, reason) => disconnects.push(reason ?? "");
    raw.open();
    raw.sendResult = false;

    expect(socket.sendKeepalive()).toBe(false);
    expect(raw.disconnectCalls).toBe(1);
    expect(disconnects).toEqual(["SIP keepalive send failed"]);
  });

  test("a thrown native send error also enters JsSIP recovery", () => {
    const raw = new ThrowingSendSocket();
    const socket = new SipKeepaliveSocket(raw);
    const disconnects: string[] = [];
    socket.ondisconnect = (_error, _code, reason) => disconnects.push(reason ?? "");
    raw.open();

    expect(socket.sendKeepalive()).toBe(false);
    expect(raw.disconnectCalls).toBe(1);
    expect(disconnects).toEqual(["native send failed"]);
  });

  test("manual disconnect clears a pending deadline", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    raw.open();
    socket.sendKeepalive();

    socket.disconnect();

    expect(scheduler.size()).toBe(0);
    expect(raw.disconnectCalls).toBe(1);
  });

  test("observe policy never disconnects for a missing pong", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, {
      ...scheduler,
      maxConsecutiveMisses: 1,
      pongPolicy: "observe",
    });
    raw.open();
    socket.sendKeepalive();

    scheduler.runNext();

    expect(raw.disconnectCalls).toBe(0);
    expect(socket.getDiagnostics().consecutiveKeepaliveMisses).toBe(1);
  });

  test("requires fresh keepalive confirmation after every WebSocket connection", () => {
    const raw = new FakeSocket();
    const socket = new SipKeepaliveSocket(raw);
    raw.open();
    socket.confirmServerKeepaliveSupport();
    expect(socket.getDiagnostics().keepaliveResponseRequired).toBe(true);

    raw.close();
    raw.open();

    expect(socket.getDiagnostics().keepaliveResponseRequired).toBe(false);
    expect(socket.getDiagnostics().keepaliveResponseSupported).toBe(false);
  });

  test("a stale deadline cannot close a later socket generation", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    raw.open();
    socket.confirmServerKeepaliveSupport();
    socket.sendKeepalive();

    raw.close();
    raw.open();
    expect(scheduler.size()).toBe(0);
    expect(raw.disconnectCalls).toBe(0);
  });

  test("forwards a natural disconnect and clears its keepalive deadline", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, scheduler);
    const disconnects: Array<{ error: boolean; code?: number; reason?: string }> = [];
    socket.ondisconnect = (error, code, reason) => disconnects.push({ error, code, reason });
    raw.open();
    socket.sendKeepalive();

    raw.close(true, 1006, "abnormal");

    expect(scheduler.size()).toBe(0);
    expect(disconnects).toEqual([{ error: true, code: 1006, reason: "abnormal" }]);
  });

  test("a throwing diagnostics observer cannot prevent transport recovery", () => {
    const raw = new FakeSocket();
    const scheduler = createScheduler();
    const socket = new SipKeepaliveSocket(raw, {
      ...scheduler,
      maxConsecutiveMisses: 1,
      pongPolicy: "required",
      onEvent: () => {
        throw new Error("telemetry failure");
      },
    });
    const disconnects: string[] = [];
    socket.ondisconnect = (_error, _code, reason) => disconnects.push(reason ?? "");
    raw.open();

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      expect(socket.sendKeepalive()).toBe(true);
      scheduler.runNext();
    } finally {
      console.error = originalConsoleError;
    }

    expect(raw.disconnectCalls).toBe(1);
    expect(disconnects).toEqual(["SIP CRLF keepalive timeout"]);
  });
});
