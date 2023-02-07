import os
import datetime

def add_date_to_frontmatter(file, date):
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
        lines.insert(index, f'date: {date.isoformat()}\n')
        f.write(''.join(lines))

user_input = input("Enter the starting date in dd/mm/yyyy format: ")
start_date = datetime.datetime.strptime(user_input, '%d/%m/%Y')
current_date = start_date
counter = 0
for filename in os.listdir('./add-dates'):
    if filename.endswith('.md'):
        file = os.path.join('./add-dates', filename)
        add_date_to_frontmatter(file, current_date)
        os.rename(file, os.path.join('./dates-added', filename))
        current_date += datetime.timedelta(days=1)
        counter += 1

print(f'{counter} files were edited and moved to the dates-added directory.')
