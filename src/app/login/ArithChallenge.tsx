// 산술 4지선다 보안 위젯 — 클라이언트 전용 (dynamic ssr:false 대상)
// SSR 단계에선 동일 높이 placeholder만, CSR 마운트 시 첫 페인트부터 실제 문제 표시
// → layout shift 0, 새로고침 시 "있고 없고" 깜빡임 완전 제거
'use client';

import { useState } from 'react';

export const PAL = {
  ink: '#1F2937',
  inkSoft: '#4B5563',
  mute: '#52606D',
  line: '#E7E2D5',
  violet: '#6E37CC',
  violetPale: '#E4DCF6',
} as const;

export interface ArithValue {
  a: number;
  b: number;
  answer: number;
  selected: number | null;
}

function makeProblem(): { a: number; b: number; answer: number; choices: number[] } {
  const a = 1 + Math.floor(Math.random() * 9); // 1~9
  const b = 1 + Math.floor(Math.random() * 9); // 1~9
  const answer = a + b;
  const wrongs = new Set<number>();
  while (wrongs.size < 3) {
    const delta = (Math.floor(Math.random() * 2) + 1) * (Math.random() < 0.5 ? -1 : 1);
    const cand = answer + delta;
    if (cand !== answer && cand >= 1) wrongs.add(cand);
  }
  const choices = [answer, ...wrongs].sort(() => Math.random() - 0.5);
  return { a, b, answer, choices };
}

// onValueChange — 부모(LoginPage)가 a·b·answer·selected를 받아 검증
export function ArithChallenge({ onChange }: { onChange: (v: ArithValue) => void }) {
  // lazy init — useState 초기값 함수형 (마운트 시 단 1회 실행, Strict Mode double-effect 영향 0)
  const [problem, setProblem] = useState(() => makeProblem());
  const [selected, setSelected] = useState<number | null>(null);

  // 부모에게 현재 값 전달 (selected 변경 시)
  const notify = (sel: number | null) => {
    onChange({ a: problem.a, b: problem.b, answer: problem.answer, selected: sel });
  };

  const regen = () => {
    const next = makeProblem();
    setProblem(next);
    setSelected(null);
    onChange({ a: next.a, b: next.b, answer: next.answer, selected: null });
  };

  return (
    <fieldset className="rounded-xl border-2 p-3" style={{ borderColor: PAL.violetPale, minHeight: 168 }}>
      <legend className="px-2 text-xs font-black tracking-wider" style={{ color: PAL.violet }}>
        🧮 보안 확인 — 산술 정답 1개 선택
      </legend>
      <div className="mb-2 text-center text-lg font-black tabular-nums" style={{ color: PAL.ink }}>
        {problem.a} <span style={{ color: PAL.mute }}>+</span> {problem.b} <span style={{ color: PAL.mute }}>=</span> ?
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {problem.choices.map((c, idx) => (
          <button
            key={`${problem.a}-${problem.b}-${idx}-${c}`}
            type="button"
            onClick={() => {
              setSelected(c);
              notify(c);
            }}
            className="h-10 rounded-lg border-2 text-sm font-black tabular-nums transition hover:scale-105"
            style={{
              borderColor: selected === c ? PAL.violet : PAL.line,
              backgroundColor: selected === c ? PAL.violetPale : 'white',
              color: selected === c ? PAL.violet : PAL.inkSoft,
            }}
            aria-pressed={selected === c}
            aria-label={`정답 후보 ${c}`}
          >
            {c}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={regen}
        className="mt-2 w-full text-[11px] font-semibold underline-offset-2 hover:underline"
        style={{ color: PAL.mute }}
        title="새 산술 문제로 교체"
      >
        ↻ 문제 새로 받기
      </button>
    </fieldset>
  );
}

// SSR + 첫 로드 placeholder — 동일 높이로 layout shift 0
export function ArithPlaceholder() {
  return (
    <div
      className="rounded-xl border-2"
      style={{ borderColor: PAL.violetPale, minHeight: 168 }}
      aria-hidden="true"
    />
  );
}
