/**
 * M0 deterministic smoke check: confirm Ink renders under Bun without crashing,
 * then unmount and exit cleanly (does not block on waitUntilExit).
 */
import React from 'react';
import { render, Box, Text } from 'ink';

function Smoke() {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">zent</Text>
      <Text dimColor>Ink + Bun render OK</Text>
    </Box>
  );
}

const instance = render(<Smoke />);
// Give Ink one tick to flush its first frame, then tear down.
await new Promise((r) => setTimeout(r, 100));
instance.unmount();
instance.clear();
console.log('\n[smoke] Ink+Bun OK');
process.exit(0);
