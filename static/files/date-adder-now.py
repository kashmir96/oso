import os
import datetime

def add_date_to_frontmatter(file):
    with open(file, 'r') as f:
        lines = f.readlines()
    index = 0
    count = 0
    for i, line in enumerate(lines):
        if line == "---\n":
            count += 1
            if count == 2:
                index = i
                break
    with open(file, 'w') as f:
        lines.insert(index, f'date: {datetime.datetime.now().isoformat()}\n')
        f.write(''.join(lines))

counter = 0
for filename in os.listdir('./add-dates'):
    if filename.endswith('.md'):
        file = os.path.join('./add-dates', filename)
        add_date_to_frontmatter(file)
        os.rename(file, os.path.join('./dates-added', filename))
        counter += 1

print(f'{counter} files were edited and moved to the dates-added directory.')
