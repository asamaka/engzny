const plist = require('plist');
const fs = require('fs');
const path = require('path');

// Apple Shortcut structure for: Screenshot -> Upload -> Open URL
function generateShortcut(apiBaseUrl = 'https://thinx.fun') {
  const shortcut = {
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: 4282601983, // Purple color
      WFWorkflowIconGlyphNumber: 59511, // Camera icon
    },
    WFWorkflowClientVersion: '2302.0.4',
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowActions: [
      // Action 1: Take Screenshot
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.takescreenshot',
        WFWorkflowActionParameters: {},
      },
      // Action 2: Get Contents of URL (POST with image)
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
        WFWorkflowActionParameters: {
          WFURL: `${apiBaseUrl}/api/upload`,
          WFHTTPMethod: 'POST',
          WFHTTPBodyType: 'Form',
          WFFormValues: {
            Value: {
              WFDictionaryFieldValueItems: [
                {
                  WFKey: {
                    Value: {
                      string: 'image',
                    },
                    WFSerializationType: 'WFTextTokenString',
                  },
                  WFItemType: 3, // File type
                  WFValue: {
                    Value: {
                      Type: 'ExtensionInput',
                    },
                    WFSerializationType: 'WFTokenAttachment',
                  },
                },
              ],
            },
            WFSerializationType: 'WFDictionaryFieldValue',
          },
        },
      },
      // Action 3: Get Dictionary Value (get viewUrl)
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.getvalueforkey',
        WFWorkflowActionParameters: {
          WFDictionaryKey: 'viewUrl',
        },
      },
      // Action 4: Create full URL by combining base URL with viewUrl
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.gettext',
        WFWorkflowActionParameters: {
          WFTextActionText: {
            Value: {
              string: `${apiBaseUrl}\uFFFC`,
              attachmentsByRange: {
                '{11, 1}': {
                  Type: 'ActionOutput',
                  OutputName: 'Value',
                  OutputUUID: 'value-uuid',
                },
              },
            },
            WFSerializationType: 'WFTextTokenString',
          },
        },
      },
      // Action 5: Open URL
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.openurl',
        WFWorkflowActionParameters: {},
      },
    ],
    WFWorkflowInputContentItemClasses: [
      'WFAppStoreAppContentItem',
      'WFArticleContentItem',
      'WFContactContentItem',
      'WFDateContentItem',
      'WFEmailAddressContentItem',
      'WFGenericFileContentItem',
      'WFImageContentItem',
      'WFiTunesProductContentItem',
      'WFLocationContentItem',
      'WFDCMapsLinkContentItem',
      'WFAVAssetContentItem',
      'WFPDFContentItem',
      'WFPhoneNumberContentItem',
      'WFRichTextContentItem',
      'WFSafariWebPageContentItem',
      'WFStringContentItem',
      'WFURLContentItem',
    ],
    WFWorkflowTypes: [],
    WFWorkflowImportQuestions: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: false,
  };

  return shortcut;
}

// Generate a simpler, more compatible shortcut structure
function generateSimpleShortcut(apiBaseUrl = 'https://thinx.fun') {
  const shortcut = {
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: 4282601983,
      WFWorkflowIconGlyphNumber: 59511,
    },
    WFWorkflowClientVersion: '2605.0.5',
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowActions: [
      // Action 1: Take Screenshot
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.takescreenshot',
        WFWorkflowActionParameters: {
          WFScreenshotMainMonitorOnly: false,
          WFScreenshotType: 'Full Screen',
        },
      },
      // Action 2: Set Variable to store the screenshot
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.setvariable',
        WFWorkflowActionParameters: {
          WFVariableName: 'Screenshot',
        },
      },
      // Action 3: Get Contents of URL (POST multipart with image)
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
        WFWorkflowActionParameters: {
          WFURL: `${apiBaseUrl}/api/upload`,
          WFHTTPMethod: 'POST',
          WFHTTPBodyType: 'Form',
          WFFormValues: {
            Value: {
              WFDictionaryFieldValueItems: [
                {
                  WFKey: {
                    Value: {
                      string: 'image',
                    },
                    WFSerializationType: 'WFTextTokenString',
                  },
                  WFItemType: 3,
                  WFValue: {
                    Value: {
                      VariableName: 'Screenshot',
                      Type: 'Variable',
                    },
                    WFSerializationType: 'WFTokenAttachment',
                  },
                },
              ],
            },
            WFSerializationType: 'WFDictionaryFieldValue',
          },
        },
      },
      // Action 4: Get Dictionary Value (viewUrl)
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.getvalueforkey',
        WFWorkflowActionParameters: {
          WFDictionaryKey: 'viewUrl',
        },
      },
      // Action 5: Set variable for viewUrl
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.setvariable',
        WFWorkflowActionParameters: {
          WFVariableName: 'ViewUrl',
        },
      },
      // Action 6: Text - combine base URL with viewUrl
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.gettext',
        WFWorkflowActionParameters: {
          WFTextActionText: {
            Value: {
              string: `${apiBaseUrl}\uFFFC`,
              attachmentsByRange: {
                '{11, 1}': {
                  VariableName: 'ViewUrl',
                  Type: 'Variable',
                },
              },
            },
            WFSerializationType: 'WFTextTokenString',
          },
        },
      },
      // Action 7: Open URL in Safari
      {
        WFWorkflowActionIdentifier: 'is.workflow.actions.openurl',
        WFWorkflowActionParameters: {},
      },
    ],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowTypes: [],
    WFWorkflowImportQuestions: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: false,
  };

  return shortcut;
}

// Main execution
const apiBaseUrl = process.argv[2] || 'https://thinx.fun';
console.log(`Generating shortcut for API: ${apiBaseUrl}`);

const shortcutData = generateSimpleShortcut(apiBaseUrl);
const plistXml = plist.build(shortcutData);

// Save as XML plist (can be imported on macOS/iOS)
const outputPath = path.join(__dirname, '..', 'public', 'thinx-screenshot.shortcut');
fs.writeFileSync(outputPath, plistXml);

console.log(`Shortcut saved to: ${outputPath}`);
console.log('Users can download and import this shortcut file.');
