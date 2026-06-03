// Vitest 설정 — 계산 로직 단위 테스트 (Node 환경, 순수 함수 대상)

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
