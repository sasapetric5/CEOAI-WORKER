---
name: aria-label-audit
description: Audit ARIA labels and accessibility attributes for correctness and completeness. [Maps to P9.]
version: 0.1.0
execution-mode: advisory
argument-hint: <url-or-file-path>
category: dev-tools
status: candidate
---
# ARIA Label Audit Command

Scan web content for ARIA attributes, labels, and accessibility properties to ensure they are correctly implemented and provide meaningful information to assistive technologies.

## When to Use
- Developing or reviewing custom UI components
- When user mentions ARIA implementation concerns
- During accessibility audits focusing on screen reader experience
- Testing dynamic content that relies heavily on ARIA
- Validating complex widgets (menus, dialogs, grids, etc.)

## Execution

### 1. Parse Input Target
Accept URL or file path to HTML content:
- Fetch remote content or read local file
- Parse DOM to identify elements with ARIA attributes
- Extract all aria-* attributes and role assignments

### 2. Validate ARIA Implementation
Check each ARIA usage against ARIA specification:
- **Roles**: Validate role values are permitted and not abstract
- **Properties**: Ensure correct usage (aria-label, aria-labelledby, aria-describedby, etc.)
- **States**: Verify state attributes match element capabilities (aria-checked, aria-expanded, etc.)
- **Relationships**: Confirm ID references exist in document
- **Required Attributes**: Check that roles have required aria-* attributes
- **Prohibited Attributes**: Ensure no conflicting or forbidden attributes

### 3. Assess Label Quality
For elements requiring accessible names:
- Check if aria-label provides meaningful, concise description
- Verify aria-labelledby references visible, descriptive content
- Ensure aria-describedby provides supplementary, not redundant, information
- Flag empty, misleading, or overly verbose labels

### 4. Check State Management
For interactive elements:
- Validate that state attributes (aria-checked, aria-selected, aria-expanded, etc.) update correctly
- Ensure state changes are announced through proper mechanisms
- Confirm that native HTML alternatives aren't being overridden unnecessarily

### 5. Generate Detailed Report
Provide specific, actionable findings with severity ratings and fix recommendations.

## Output Format
```
ARIA Label Audit | <url-or-file-path>
════════════════════════════
Target: <audit-target>
Audit Time: <timestamp>
Elements with ARIA: <count>/<total-elements>

## Summary
- Total ARIA Issues: <count>
  - Errors: <count> | Warnings: <count> | Notices: <count>
- ARIA Usage Score: <score>/100
- Elements Missing Accessible Names: <count>

## Role Validation
<if issues-found>
### Invalid Roles
1. **Role="invalidrole"** on <div> (line 45)
   **Issue**: "invalidrole" is not a valid ARIA role
   **Fix**: Use appropriate role like "button" or remove if not needed

### Abstract Roles Used
2. **Role="range"** on <input type="range"> (line 78)
   **Issue**: "range" is an abstract role, should not be used directly
   **Fix**: Remove role attribute (native <input type="range"> provides implicit role)
<else>
✅ All ARIA roles are valid and properly used
## End If

## Property & State Issues
<if label-issues-found>
### Missing or Poor Labels
1. **Element**: <button id="submit"> (line 102)
   **Issue**: Button has no accessible name
   **Current**: No aria-label, aria-labelledby, or inner text
   **Fix**: Add aria-label="Submit form" or provide inner text

2. **Element**: <div aria-label="Close modal window X"> (line 156)
   **Issue**: Label is redundant (announces "Close modal window X X")
   **Current**: aria-label="Close modal window X" + visible "×" 
   **Fix**: Use aria-label="Close" or rely on visible content
<else>
✅ All labeled elements have appropriate accessible names
## End If

<if relationship-issues-found>
### Broken Relationships
1. **Element**: <label for="username"> (line 200)
   **Issue**: aria-labelbm="username" references non-existent ID
   **Current**: aria-labelledby="username" (typo in attribute name)
   **Fix**: Correct to aria-labelledby="username" and ensure element exists
<else>
✅ All ARIA relationship attributes reference existing elements
## End If

## Recommendations
PRIORITY: Fix missing accessible names on interactive controls
SECONDARY: Remove redundant or incorrect ARIA attributes
NEXT: Run [a11y-audit] for comprehensive accessibility testing
Estimated effort: <S/M/L>

## Base120 Context
- Primary: **P9** (Cultural Adaptation - ensuring equivalent access)
- Related: **DE5** (Finding vital few ARIA issues), **IN6** (Verifying ARIA correctness claims)

## After Completion
Naturally chains to: Fix identified issues, then run `[a11y-audit]` for full verification
