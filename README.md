# What is xWeek?
xWeek is a personal ai-based week planner that takes natural language input and modifies the user's week plan.

# How does it work?
xWeek uses an openai compatible api to make decisions. It can add, modify and remove tasks from the database.
xWeek can take a large task and decide whether to break it down to smaller tasks and plan them or not.

# Database Structure
xWeek stores its data as database records. There are a few tables: 
1. Month
2. Week
3. Day
4. Task

### Relations
- each month has many weeks
- each week has many days
- each day has many tasks

# Usecase examples
1.
- User: I go to gym everyday from 19:00 to 21:00
- xWeek: {Adds a task(gym, everyday, 19:00, 21:00)}

2. 
- User: I need to study 20h in 5 days
- xWeek: {Adds a 4h study task for 5 days}

3. 
- User: I need to make a meeting with Josh
- xWeek: {(Thinking process: a meeting is better to be done in the morning. based on the user's week, it seems we can setup a meeting on 10:00am Monday) Adds a meeting task on Monday 10:00am}

4. 
- User: How much free time do I have per day?
- xWeek: {(retrieves user's tasks. No tasks added or modified. Just a simple answer)} based on your current tasks, you have about 4h free a day

5. 
- User: Do you think I can afford a new part time job?
- xWeek: {(retrieves user's tasks) (Thinking process: A part-time job can take up to 5h a day and the user does not have enough time for it)} No, you can't take a new part-time job if it's gonna take 5h a day.

# GUI
xWeek uses a web-based gui to take user input and show the calendar. The user can add, modify and remove tasks manually from the gui.

# Technical Stack
xWeek uses typescript and express for the backend and it uses react for the gui. 

# Usage
`npm run dev` - runs a dev server that refreshes files immediately when they are edited
`npm run build` - exports the project's file to a `out` directory that can be served via nginx
