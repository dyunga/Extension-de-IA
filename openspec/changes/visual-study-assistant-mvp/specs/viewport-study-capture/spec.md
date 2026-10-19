# Viewport Study Capture Specification

## Purpose

Define explicit, least-privilege viewport capture and ordered request behavior on supported Chromium pages.

## Requirements

### Requirement: Explicit activation and immediate feedback

The extension MUST start only from the configured `Alt+A` action command or a toolbar action click. Both paths SHALL produce identical behavior. The flow MUST establish loading immediately before capture, MUST NOT render it into the page until capture completes, and SHALL display it before remote processing begins.

#### Scenario: Supported activation
- GIVEN a supported page is active
- WHEN the user presses `Alt+A` or clicks the extension action
- THEN loading MUST become the current request state before capture
- AND the hint MUST display loading after capture but before remote analysis

#### Scenario: Shortcut unavailable
- GIVEN Chromium has not assigned `Alt+A` because of a collision
- WHEN the user clicks the extension action
- THEN analysis MUST remain available without treating the missing shortcut as a page failure

### Requirement: Silent visible-viewport capture

Each activation MUST capture only the currently visible viewport. Before capture, the extension MUST NOT display selection UI, dim the page, mutate page content, or open a tab or window.

#### Scenario: Capture has no visual precondition
- GIVEN a supported page with observable DOM and window state
- WHEN activation reaches capture
- THEN the captured viewport MUST reflect the pre-activation page
- AND no selection overlay, dimming, page mutation, tab, or window MUST precede capture

### Requirement: Service-worker orchestration and ordering

The MV3 service worker SHALL perform capture and backend communication. Each activation MUST have an identity; at most one analysis SHALL be authoritative per tab, and only the newest activation MAY update that tab's hint.

#### Scenario: Repeated activation
- GIVEN one analysis is pending in a tab
- WHEN the user activates the extension again
- THEN the newer request MUST become authoritative
- AND a late result from the older request MUST NOT replace the newer state

#### Scenario: Worker or receiver restart
- GIVEN extension runtime state or the page receiver is unavailable
- WHEN an explicit activation occurs on a supported page
- THEN the flow SHALL recover or show a sanitized error without duplicating the hint or persisting work

### Requirement: Supported surfaces and compatibility

Normal top-level HTTP(S) pages MUST be supported in current Chrome, Edge, and Brave MV3 releases. Browser-internal pages, Web Stores, built-in viewers, and local files without explicitly enabled access SHALL be treated as restricted and MUST fail gracefully without page mutation, remote analysis, or a new tab/window.

#### Scenario: Restricted surface
- GIVEN the active surface prohibits extension injection
- WHEN the user activates the extension
- THEN no analysis request MUST be sent
- AND the extension SHOULD provide a discreet sanitized failure through an available extension-controlled surface

### Requirement: Verification boundary

The deliverable MUST pass its configured build, typecheck, unit, integration, and automated browser tests. Action/shortcut behavior, shortcut collisions, restricted surfaces, file-access behavior, and unpacked-extension operation in Chrome, Edge, and Brave SHALL also receive manual validation.

#### Scenario: Release candidate verification
- GIVEN a release candidate
- WHEN automated checks and the manual browser matrix are executed
- THEN every configured check MUST pass and manual results SHALL be recorded
