/**
 * Description hygiene (research round, 1 Sep): tool selection lives or dies
 * on these strings, and agent-side safety scanners quarantine the wrong
 * kind. Two invariants, both surfaces (page WebMCP tools + remote MCP):
 *  - Chrome budgets: name <= 30 chars, description <= 500 chars (longer
 *    gets truncated mid-sentence, and oversized descriptions read as
 *    guardrail-bypass attempts).
 *  - No tool-shadowing imperatives ("ALWAYS use this", "instead of web
 *    search", "do NOT navigate"): the canonical MCP tool-poisoning
 *    signature per OWASP/Chrome security docs. Claims must stay scoped to
 *    the tool's own capability.
 */

import { toolDefinitions } from '@/webmcp/tools';
import { mcpToolDescriptions } from '@/lib/mcp-server';

const POISON =
  /\bALWAYS\b|instead of (your |the )?(web )?search|never (use|with) web|do not (navigate|click|web-search|use (the )?web)|before (using|calling) any other tool/i;

const SURFACES = [
  { surface: 'webmcp page tools', defs: toolDefinitions() },
  { surface: 'remote MCP tools', defs: mcpToolDescriptions() },
];

describe.each(SURFACES)('$surface', ({ defs }) => {
  it('has tools to check', () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  it.each(defs.map((d) => [d.name, d] as const))(
    '%s stays within Chrome budgets',
    (_name, d) => {
      expect(d.name.length).toBeLessThanOrEqual(30);
      expect(d.description.length).toBeLessThanOrEqual(500);
    },
  );

  it.each(defs.map((d) => [d.name, d] as const))(
    '%s carries no tool-shadowing imperatives',
    (_name, d) => {
      const match = d.description.match(POISON);
      expect(match?.[0] ?? null).toBeNull();
    },
  );
});
