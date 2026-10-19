# Transient Hint Bar Specification

## Requirements

### Requirement: Singleton isolated component

The extension MUST reuse one top-frame hint component per document. The component SHALL render inside Shadow DOM, MUST remain isolated from host-page CSS, and MUST render response data as text rather than executable markup.

#### Scenario: First and repeated use
- GIVEN no hint exists in the document
- WHEN the extension first publishes a state and later publishes another
- THEN exactly one hint host MUST exist and the same component SHALL display both states

#### Scenario: Hostile page styles
- GIVEN the host page defines broad conflicting CSS rules
- WHEN the hint is shown
- THEN its layout and readable presentation MUST remain intact

### Requirement: Loading, success, error, and close states

The hint MUST support visible loading, success, and sanitized error states. It MUST provide a close control, and a later explicit activation MUST be able to show the reusable component again.

#### Scenario: State progression
- GIVEN a supported activation
- WHEN analysis succeeds or fails
- THEN loading MUST precede the corresponding success or error state

#### Scenario: Close and reopen
- GIVEN the hint is visible
- WHEN the user closes it and later activates the extension
- THEN it MUST hide on close and reappear in loading state for the new activation

### Requirement: Interaction-driven dismissal

While loading is visible, current-webpage clicks outside the `×` control MUST be ignored so the eventual success or sanitized error remains visible. The `×` MUST remain an explicit dismissal path and, during loading, MUST cancel only the matching active request. After success or error is visible, any current-webpage click outside the `×` control MUST dismiss the hint. Dismissal MUST remove the page listener, remain effective for that activation, and MUST NOT be time-based.

#### Scenario: Page click during loading preserves the eventual state
- GIVEN the hint is visible in loading state for the current activation
- WHEN the user clicks anywhere in the webpage outside the `×` control
- THEN the loading state MAY remain visible or compacted
- AND a later success or sanitized error for that activation MUST be shown

#### Scenario: Page click after result dismisses the hint
- GIVEN the hint is visible in success or error state for the current activation
- WHEN the user clicks anywhere in the webpage outside the `×` control
- THEN the hint MUST hide

#### Scenario: Close control dismisses the hint
- GIVEN the hint is visible
- WHEN the user clicks the `×` control
- THEN the hint MUST hide
- AND if the hint was loading, the matching active request MUST be canceled and late states for that request MUST NOT be shown

#### Scenario: Listener cleanup across lifecycle changes
- GIVEN the hint is dismissed, unmounted, or shown for a later activation
- WHEN its listener lifecycle changes
- THEN obsolete listeners MUST be removed and at most one page-dismiss listener MUST be active

#### Scenario: Activation does not dismiss the newly shown hint
- GIVEN the hint is hidden
- WHEN the toolbar action or shortcut makes it reappear
- THEN that activation MUST NOT count as a webpage click and the hint MUST remain visible

#### Scenario: No time-based dismissal
- GIVEN the hint is visible without a dismissal interaction
- WHEN time elapses
- THEN the hint MUST remain visible

### Requirement: Compact responsive presentation

The hint MUST be fixed at the bottom center with fit-content sizing, explicit minimum and maximum width, wrapped text, dynamic height, and a sufficiently high stacking order to remain visible above ordinary page content. State changes SHOULD use subtle transitions and MUST honor reduced-motion preferences.

#### Scenario: Short and long content
- GIVEN success text ranging from one short answer to a 60-word explanation
- WHEN the hint renders it at a supported viewport width
- THEN width MUST remain within its bounds, text MUST wrap, and height MUST adapt without clipping

#### Scenario: Reduced motion
- GIVEN the operating environment requests reduced motion
- WHEN the hint appears or changes state
- THEN nonessential motion MUST be removed or minimized

### Requirement: Stale update rejection

The hint MUST associate updates with activation identity and MUST ignore states from any request older than the latest accepted activation.

#### Scenario: Responses arrive out of order
- GIVEN two activations whose older response arrives last
- WHEN both responses reach the hint
- THEN only the newer activation's state MUST remain visible
