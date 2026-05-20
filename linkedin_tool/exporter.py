import json 
import csv 
import sqlite3 
import os 
 
class DataExporter: 
    @staticmethod 
    def save_to_json(data, filename): 
        with open(filename, 'w') as f: 
            json.dump(data, f, indent=4) 
 
    @staticmethod 
    def save_to_csv(data, filename): 
        with open(filename, 'w', newline='') as f: 
            writer = csv.writer(f) 
            writer.writerow(['Field', 'Value']) 
            for key, value in data.items(): 
                writer.writerow([key, json.dumps(value) if isinstance(value, list) else value])
 
    @staticmethod 
    def save_to_sqlite(data, db_name): 
        conn = sqlite3.connect(db_name) 
        cursor = conn.cursor() 
        cursor.execute('''CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, headline TEXT, location TEXT, about TEXT, experience TEXT, education TEXT)''') 
        cursor.execute('''INSERT INTO profiles (full_name, headline, location, about, experience, education) VALUES (?, ?, ?, ?, ?, ?)''', ( 
            data.get('full_name'), data.get('headline'), data.get('location'), data.get('about'), json.dumps(data.get('experience')), json.dumps(data.get('education')) 
        )) 
        conn.commit() 
        conn.close()
