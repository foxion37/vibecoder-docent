# 0043 — Herdr agents 창에 도슨트 터미널을 알린다

Date: 2026-10-07
Status: Accepted. 사용자 요청.

## Context

사용자는 Herdr 분할 창에서 코딩 에이전트와 도슨트 터미널(`docent-tui`)을 함께 쓴다. Herdr의 agents 창에는 omp 같은 코딩 에이전트만 보이고 도슨트는 보이지 않았다. Herdr는 다른 프로그램이 자기 상태를 알리는 공식 방법(`herdr pane report-agent`, `release-agent`)을 제공한다.

## Decision

1. `docent-tui`는 `HERDR_ENV=1`이고 `HERDR_PANE_ID`, `HERDR_BIN_PATH`가 있을 때만 Herdr에 알린다. 이름은 `docent`, 출처는 `vibecoder-docent`다. Herdr 밖에서는 아무것도 하지 않는다.
2. 상태는 이 터미널에서 직접 물은 설명만 따른다. 설명이 없으면 `idle`, 진행 중이면 `working`(설명 단계 문구), 연결이 끊기면 `blocked`("Ctrl+R로 다시 연결")다. 미리 설명은 서버가 탭과 상관없이 하는 일이라 알리지 않는다. agents 창이 계속 바뀌고 완료 알림이 늘어나는 것을 막기 위해서다.
3. 같은 상태는 다시 보내지 않고, 보내는 중에 쌓인 변화는 마지막 것만 보낸다. 순서 번호는 시각 기반으로 계속 커진다. 실패는 무시하고 화면을 막지 않는다.
4. 재시작 복구 명령으로 `docent-tui`(기본 주소가 아니면 `--url` 포함)를 함께 알린다. Herdr 0.10 이상에서 쓰이고 그 전 버전은 무시한다.
5. 사용자가 종료하면 `release-agent`로 표시를 지운다.
6. 메인 에이전트가 사용자에게 질문한 순간을 도슨트의 `blocked`로 알리는 기능은 넣지 않는다. 그 에이전트 창에도 같은 알림이 떠서 겹친다.

## Consequences

- agents 창에서 도슨트를 보고 바로 이동할 수 있고, 설명이 끝나면 Herdr 완료 표시가 붙는다.
- Herdr 0.9.3에서 대기, 작업 중, 완료, 종료 시 제거를 확인했다. 재시작 복구는 Herdr 0.10 이후에 동작한다.
- 테스트는 실제 Herdr를 건드리지 않도록 `runTerminal`에 빈 환경을 넘긴다.
