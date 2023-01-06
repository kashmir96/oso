---
title: "Guide to Creating a Blazing Fast Website + Blog"
date: 2023-01-06T13:48:01+13:00
draft: false
type: Learns
category: "workflow"
tags: "marketing", "websites", "blogging", "hugo"

---

## Useful resources: 
Getting started with Hugo: https://www.youtube.com/watch?v=hjD9jTi_DQ4
Markdown cheat sheet: https://github.com/adam-p/markdown-here/wiki/Markdown-Cheatsheet
Yml documentation to understand syntax

## Preparing your mac
<a href="https://brew.sh">Brew.sh</a>
<a href="https://go.dev/doc/install">Go
<a href="https://git-scm.com/book/en/v2/Getting-Started-Installing-Git">Git</a>
<a href="https://gohugo.io">Hugo</a>
<a href="https://code.visualstudio.com/download">Visual studio code</a>
<a href="https://www.netlify.com">Netlify</a>
<a href="https://usefathom.com">Fathom</a>

1. Install homebrew - `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
`brew -v` to see if it’s already installed
2. Install git
3. Install visual studio code, then open explorer and look for “Shell Command: Install ‘code’ command in PATH select. 
4. Install hugo - `brew install hugo`

## Steps to creating the site 
1. Create Hugo site 
- cd into desired location
- Create the new site with Hugo in terminal: hugo new site {site name} -f yml
2. Pick or create a theme and upload into the site’s themes folder with git clone (if picking, check docs to learn theme’s capabilities - e.g. papermod): git clone https://github.com/adityatelange/hugo-PaperMod themes/PaperMod --depth=1
Update config file - copy and tweak from previous.
3. Test: Hugo server, then go to localhost:1313 in browser
4. Add posts to the content folder: hugo new posts/{postname}.md (or copy generated files from smartsheet)
5. Add pages: top level add straight into content, index.html goes into layouts with an index.md file in content.  
6. Add images: site file > static > img > {paste}
Editing theme: Copy exact folder structure for desired page in themes, copy to same on main site.

## Publishing
1. Create git repo with site files - cd into folder then: git init
2. Create gitmodules file: touch .gitmodules (copy/tweak another gitmodules)
3. Sign into github through vscode, commit changes to public (cmd shift p)
4. Once uploaded, go to Netlify interface and create a new site from git, connect to git, select repo, settings: Build command = hugo, Publish directory = Public, show advanced > HUGO_VERSION {get from terminal with hugo version command}, Save. 
5. Edit domain settings, point to netlify DNS from Hover, verify. 
6. Do A RECORD for plain domain, use @ for host
7. Do CNAME for www domain, put www in host, url in other field
8. Open site’s config.yml and update baseURL to match domain.
9. Commit: git commit -m “{your message}”
10. Push live: git push

## showing ownership of repo in git with SSH keys (first site only)
1. Generate key in terminal: ~ ssh-keygen -t rsa -b 4096 -C “email@example.com” {keyname} 
2. After pressing enter, give it a password
3. Search for the key you just generated in terminal and ensure it was successful: ~ls | grep {keyname} 
4. View key: ~ cat {keyname: e.g. testkey.pub}
6. Copy key:  ~ pbcopy < ~ {keyname: e.g. testkey.pub}
7. Make local machine aware of new key: Start ssh-agent in background: $ eval "$(ssh-agent -s)" 
7. Modify .ssh/config file:
8. Check it’s in default location: $ open ~/.ssh/config - If not, create the file: $ touch ~/.ssh/config
9. Open the file: vim ~.ssh/config
10. Modify the config file to include the following: 
Host *.github.com
  AddKeysToAgent yes
  UseKeychain yes
  IdentityFile ~/.ssh/{id}
11. Add your SSH private key to the ssh-agent and store your passphrase in the keychain: $ ssh-add --apple-use-keychain ~/.ssh/{id}
12. Add the SSH key to your account on github: In github > settings > ssh and gpg keys > new ssh key > create a title and select type of key, paste key into “Key” field, click Add SSH Key.
