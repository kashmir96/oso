---
title: "Adding Creation Dates to Markdown Files with Python"
description: "A Python script that iterates through all Markdown files in a directory, adds the file's creation date in ISO format to the file's content, and moves the processed files to another directory."
type: Learns
content:
  image: "/img/learns/15.webp"
  alt: "A screenshot of the code in a text editor"
date: 2023-02-12T00:00:00.000Z
---

# Script for Adding Creation Dates to Markdown Files

This script is designed to add the creation date of each Markdown file in a directory to the file's content and move the processed files to another directory. The creation date is added to the file's front matter in ISO format.

## How to Use

1. Place the `date-adder-file.py` script and the Markdown files you want to process in a directory.

2. In the script, specify the name of the input directory that contains the Markdown files and the name of the output directory where the processed files will be moved. If the output directory does not exist, the script will create it.

3. Run the script.

The script will iterate through all the Markdown files in the input directory, add the creation date to the file's content, update the file, and move the file to the output directory.

## Why You Might Need It

Adding the creation date of a file to its content can be useful for tracking when a file was created and for organizing files. This script automates the process, saving time and reducing the risk of errors.

## Download the Script

To download the Python script for adding creation dates to Markdown files, click [here](/files/date-adder-file.py)
