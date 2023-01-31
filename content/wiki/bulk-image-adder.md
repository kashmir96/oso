---
title: Automatically Add Cover Images to Markdown Blog Posts
description: This script allows you to easily add cover images to multiple markdown blog posts in a directory.
cover: 
 image: /img/learns/1.webp
 alt: 
date: 2020-01-01T13:48:01+13:00
type: Learns
category: ["Productivity"]
tags: ["Website Tools", "Markdown", "Blog Posts", "Productivity"]
---

## Introduction

Do you have a large directory of markdown blog posts that you want to add cover images to? This script makes it easy to do just that. It inserts the cover image information into the front matter section of the markdown files, and also uses regular expressions to extract the subject and company of the image from the markdown file.

## Requirements

To use this script, you will need to have Python and the os and re modules installed on your computer. You will also need to have markdown files that you want to add a cover image to in the same directory as the script.

## Running the Script

You will need to replace the placeholder text in the script with the actual values for your cover image. These values include the path to the image files and the maximum number of images to be used.

Once you have provided the necessary information, you can run the script by navigating to the directory where the script and markdown files are located and running the script using the command `python img-adder.py`.

The script will then add the cover image information to the front matter of all markdown files in the directory, using the subject and company of the image extracted from the markdown file. It also keeps track of the number of edited files and prints it at the end.

## Conclusion

This script is a great solution for adding cover images to a large directory of markdown blog posts. It saves time and effort by automating the process, and ensures consistency in the front matter of all blog posts. Just remember to be selective about which files you want to add the cover image to, as the script will add the cover image information to all markdown files in the current working directory.


## Download the Script
You can download the tool for free here: <a href="./files/broken-img-lister.zip" download="bulk-image-adder.zip">Download the pdf</a>.