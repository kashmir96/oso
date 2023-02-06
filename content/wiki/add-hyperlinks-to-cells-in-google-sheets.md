---
title: Add Hyperlinks to Cells in Google Sheets
description: This Google Script will add hyperlinks to cells in a Google Sheet based on a mapping of search phrases to links.
date: 2023-02-05
type: Learns
category: ["Productivity"]
tags: ["Google Scripts", "Productivity"]
cover:
 image: /img/learns/7.webp
 alt:
---

# Google Script for Automatically Adding Links to Spreadsheet Cells

This Google Script allows you to automatically add `<a href=""></a>` tags to cells in a Google Spreadsheet when another cell in the same row becomes not empty. The script retrieves the search term and URL from a second sheet in the spreadsheet and adds the `<a href=""></a>` tags around the search term in the specified column of the first sheet.

## Prerequisites

- A Google account
- A Google Spreadsheet with at least two sheets: one for the target cells to be updated, and one for the search terms and URLs.

## How to Use the Script

1. Open the Google Spreadsheet that you want to modify.
2. Go to the Google Apps Scripts editor by clicking on the “Tools” menu, then selecting “Script Editor.”
3. Copy the script into the editor and save the script by clicking “File” and then “Save.”
4. Close the script editor.
5. In the Google Spreadsheet, go to the first sheet (the target sheet) and specify the column to be checked for changes and the column to add the links to.
6. In the second sheet, specify the search terms in the first column and the corresponding URLs in the second column.
7. Add some data to a cell in the first sheet to trigger the script and see the links being added.

## Tips

- Make sure to specify the correct column numbers for both the trigger column and the link column in the script.
- Make sure that the search terms in the second sheet match the terms in the cells in the first sheet.
- You can edit the script to add or remove search terms and URLs as needed.

By using this script, you can save time by automating the process of adding links to cells in a Google Spreadsheet.

## Download the Script
You can download the tool for free here: <a href="./files/add-links-to-cells.txt" download="add-links-to-cells.txt">Download the pdf</a>.