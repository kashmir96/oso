---
title: Add Hyperlinks to Cells in Google Sheets
description: This Google Script will add hyperlinks to cells in a Google Sheet based on a mapping of search phrases to links.
date: 2023-02-05
type: Learn
category: ["Productivity"]
tags: ["Google Scripts", "Productivity"]
cover:
 image:
 alt:
---

# Google Spreadsheet Hyperlink Addition Script

This script is designed to add hyperlinks to cells within a Google Spreadsheet based on a map of search phrases and associated links. The script searches the contents of the specified cells, finds any instances of the search phrases, and surrounds the phrase with an HTML < a > tag with the associated hyperlink as its href value.

## Requirements
- A Google Spreadsheet with the specified sheets and columns.
- A Google account with access to the Google Apps Script API.
Usage

1. Open the Google Spreadsheet that you want to modify.
2. Go to Tools > Script editor to open the Apps Script project.
3. Paste the code into the script editor and save the project.
4. In the script editor, select Run > addLinksToCells to run the function.
5. Set the parameters for the function:
{{ addLinksToCells(spreadsheetId, sheetName, columnNumber, mappingSheet, searchPhraseColumn, hyperlinkColumn); }} 

## Example set parameters
Here's an example of how you might set the parameters when calling the function addLinksToCells:
{{ addLinksToCells('abc123def456ghi789', 'Sheet1', 1, 'Mapping', 1, 2); }} 

### In this example:
- 'abc123def456ghi789' is the ID of the Google Spreadsheet to be modified.
- 'Sheet1' is the name of the sheet in the Spreadsheet to be modified.
- 1 is the number of the column in the sheet that contains the cell values to be searched and modified.
- 'Mapping' is the name of the sheet in the Spreadsheet that contains the map of the search phrase and associated link.
- 1 is the number of the column in the mapping sheet that contains the search phrases.
- 2 is the number of the column in the mapping sheet that contains the hyperlinks.

## Download the Script
You can download the tool for free here: <a href="./files/add-links-to-cells.txt" download="add-links-to-cells.txt">Download the pdf</a>.