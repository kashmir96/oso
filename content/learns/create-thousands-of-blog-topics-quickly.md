---
title: "Creating thousands of unique seo blog topics quickly"
date: 2023-01-06T13:48:01+13:00
draft: false
type: Learns
category: "workflow"
tags: "marketing", "websites", "blogging", "seo"

---
## Introduction
If you've ever wondered how to think of topics for blog posts that rank quickly for terms people actually search for, this is the post for you.

Over the years I've spent hours and hours brainstorming blog posts, but with new tech brings new opportunities to streamline your workflow–and I'm all about cutting back on repetitive work!

Here's how I can create thousands of unique blog topics in under an hour using simple tools available to everyone– a spreadsheet and google recommendations. 

Google recommendations is pretty much an insight into what people search for in your area given a seed phrase. Therefore, the list of recommendations is a great place to start if you're wanting to create high-traffic topics.

Spreadsheets, well, these are pretty much just to keep everything sorted and cut back on the time you spend brainstorming putting in every combination of words.


## You will need
1. a list of keywords you want to rank with
2. a list of verbs or adjectives
3. google sheets
4. a mac computer or other software allowing you to to copy text from from screenshots (not essential but saves heaps of time)

## Steps
1. Open google sheets and create a column called "Keywords" under column A, paste all the keywords you want to rank with in here.
2. Paste your list of verbs into column B
3. In column C, paste the following formula and drag down all the way, then name this column "Prompts": 
    =INDEX(FLATTEN(FILTER(B2:B, B2:B<>"")&" "&TRANSPOSE(FILTER(A2:A, A2:A<>""))))
4. Open google.com
5. One by one, copy the prompts from column C into google to see the list of recommendations (don't click search, just screenshot the dropdown) and screenshot the results. 
    Tip: The prompts go extra far if you click your mouse cursor on each space in your pasted prompt, as you can get several lists of recommnendations from a single prompt this way. 
7. When you have enough screenshots, highlight them all and open them in a window next to your browser with your sheets open.
6. Open a new sheet in your spreadsheet and name it "Blog topics", with a heading called "topics"
7. From a screenshot, highlight the list of recommendations and paste them under the "topics" heading. Repeat the process for each individual screenshot. 
8. Voila! your list of topics ready to create blog posts from.