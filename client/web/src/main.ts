import { startApp } from './app.js';
import { runRoundtripSelftest } from './roundtrip-selftest.js';

const selftest = new URLSearchParams(location.search).get('selftest');
if (selftest === 'roundtrip') {
  void runRoundtripSelftest();
} else {
  void startApp();
}
