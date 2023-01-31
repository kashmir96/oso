---
title: Finding Broken Feature Images in Markdown Files with a Script
description: A script to help you keep track of all the broken feature images in your Markdown files.
cover: 
 image:
 alt: A broken image with a red X on it
date: 2020-01-01T13:48:01+13:00
type: Tools
category: ["Productivity"]
tags: ["Website Tools", "Markdown Files", "Productivity"]
cover: 
 image: /img/learns/2.webp
 alt: 
---

## Introduction

Do you ever struggle to keep track of all the feature images in your Markdown files? This script is here to help.

## The Purpose

The main purpose of this script is to list all the broken feature images in your Markdown files. It searches for files with the ".md" extension within a specified directory and reads the contents of each file. The script then checks for the existence of feature images and extracts the image URL.

## The Process

If the image is missing in the specified directory, the script writes the information to a CSV file named "broken_images.csv". This file will contain the title of the Markdown file, the image URL, and the status of the image (broken or not).

## Steps to Use the Script

1. Edit the "directory" parameter to specify the location of your Markdown files.
2. Edit the "missing_directory" parameter to specify the location where your images are stored.
3. Run the script.
4. Check the "broken_images.csv" file for a list of all the broken feature images in your Markdown files.

## Conclusion

By using this script, you can easily keep track of all your broken feature images in one centralized location. No more searching through multiple files to find missing images!

If you want to make sure your Markdown files are free of broken feature images, this script is a must-have tool. Try it out today and start organizing your images with ease.

## Download the Script
You can download the tool for free here: <a href="./files/broken-img-lister.zip" download="broken-img-lister.zip">Download the pdf</a>.