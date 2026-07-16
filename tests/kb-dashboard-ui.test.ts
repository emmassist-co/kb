import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../packages/kb-dashboard/dashboard/src/markdown.ts';
import { summarizeDiff } from '../packages/kb-dashboard/dashboard/src/diff.ts';

test('dashboard markdown preview escapes raw html', () => {
  const rendered = renderMarkdown('# Title\n\n<script>alert("x")</script>\n\n- item');
  assert.match(rendered, /<h1>Title<\/h1>/);
  assert.match(rendered, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.match(rendered, /<li>item<\/li>/);
});

test('dashboard html escaping handles unsafe attributes', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('dashboard markdown preview renders wiki links as record buttons', () => {
  const rendered = renderMarkdown('See [[src_2026_07_15_apsl_ownership]] and [[company_acme|Acme]].');
  assert.match(rendered, /data-action="select-record"/);
  assert.match(rendered, /data-kind="source" data-id="src_2026_07_15_apsl_ownership"/);
  assert.match(rendered, /data-kind="entity" data-id="company_acme"/);
  assert.match(rendered, />Acme<\/button>/);
});

test('dashboard diff summary reports changed added and removed lines', () => {
  assert.deepEqual(summarizeDiff('a\nb\nc', 'a\nB'), ['Line 2: changed', 'Line 3: removed']);
  assert.deepEqual(summarizeDiff('a', 'a\nb'), ['Line 2: added']);
});
