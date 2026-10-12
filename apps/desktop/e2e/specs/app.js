/**
 * Desktop e2e: the bundled app opens its window and renders the tunnel
 * console. The shell attaches to a running daemon when one answers on
 * :7432, so these specs need the daemon up (the dev loop always has it).
 */
describe("SSH Tunnel desktop app", () => {
  it("opens the main window titled SSH Tunnel", async () => {
    await browser.waitUntil(
      async () => (await browser.getTitle()).includes("SSH Tunnel"),
      { timeout: 30000, timeoutMsg: "main window never titled SSH Tunnel" },
    );
    expect(await browser.getTitle()).toContain("SSH Tunnel");
  });

  it("renders the console shell: toolbar, sidebar, content", async () => {
    const toolbar = await browser.$(".tunnel-toolbar");
    await toolbar.waitForExist({ timeout: 30000 });
    expect(await toolbar.isDisplayed()).toBe(true);

    const sidebar = await browser.$(".tunnel-sidebar");
    expect(await sidebar.isDisplayed()).toBe(true);

    const content = await browser.$(".tunnel-content");
    expect(await content.isDisplayed()).toBe(true);
  });

  it("shows the New tunnel action", async () => {
    const action = await browser.$("button=New tunnel");
    await action.waitForExist({ timeout: 30000 });
    expect(await action.isDisplayed()).toBe(true);
  });

  it("captures the console window for the gallery", async () => {
    // Best-effort wait for populated cards (daemon data may lag first
    // paint), then screenshot regardless — the image itself is the evidence
    // of what the window shows.
    await browser
      .waitUntil(
        async () => (await browser.$$(".tunnel-row")).length > 0,
        { timeout: 30000, timeoutMsg: "no tunnel rows rendered" },
      )
      .catch(() => undefined);
    // WDIO screenshots the WebView directly (not the system compositor),
    // so other windows on screen cannot cover it. Path is relative to the
    // package dir (apps/desktop); land in the repo-level gallery.
    await browser.saveScreenshot("../../screenshots/desktop-app.png");
  });
});
