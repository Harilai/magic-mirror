const { isSupportedNode, parseOsRelease, parseVersion } = require("../../../scripts/serveronly-device-check");

describe("serveronly device-check helpers", () => {
	describe("parseVersion", () => {
		it("parses a semantic Node.js version", () => {
			expect(parseVersion("v22.22.2")).toEqual([22, 22, 2]);
		});

		it("returns null for an invalid version", () => {
			expect(parseVersion("not-a-version")).toBeNull();
		});
	});

	describe("isSupportedNode", () => {
		it("accepts the minimum repository Node 22 version on ARMv7", () => {
			expect(isSupportedNode("22.22.2", "arm")).toBe(true);
		});

		it("rejects an older Node 22 version", () => {
			expect(isSupportedNode("22.22.1", "arm64")).toBe(false);
		});

		it("accepts Node 24 on ARM64", () => {
			expect(isSupportedNode("24.0.0", "arm64")).toBe(true);
		});

		it("rejects Node 24 on 32-bit ARM", () => {
			expect(isSupportedNode("24.0.0", "arm")).toBe(false);
		});

		it("accepts Node 24 on x64", () => {
			expect(isSupportedNode("24.0.0", "x64")).toBe(true);
		});

		it("rejects an unparsable version", () => {
			expect(isSupportedNode("current", "x64")).toBe(false);
		});
	});

	describe("parseOsRelease", () => {
		it("parses quoted and unquoted distro fields", () => {
			expect(parseOsRelease('ID=debian\nPRETTY_NAME="Debian GNU/Linux"')).toEqual({
				ID: "debian",
				PRETTY_NAME: "Debian GNU/Linux"
			});
		});

		it("ignores comments and malformed lines", () => {
			expect(parseOsRelease('# comment\nBROKEN_LINE')).toEqual({});
		});
	});
});
