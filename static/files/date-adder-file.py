import os
import shutil
import time

path = os.getcwd() + "/add-dates"
destination_path = os.getcwd() + "/dates-added"
total_files = 0
dates_added = []
for filename in os.listdir(path):
    if filename.endswith(".md"):
        total_files += 1
        file_path = os.path.join(path, filename)
        with open(file_path, 'r') as f:
            content = f.readlines()
        creation_time = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getctime(file_path)))
        content.insert(len(content) - 1, "date: " + creation_time + "\n")
        with open(file_path, 'w') as f:
            f.writelines(content)
        dates_added.append(creation_time)
        shutil.move(file_path, destination_path + "/" + filename)

print("Dates added:", dates_added)
print("Total files changed:", total_files)
