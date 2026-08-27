# Shot Put Field Tool

## Introduction

Shot Put Field Tool is an accessible browser-based companion for recording and understanding shot put throws. Users can enter an athlete's name and throw distance, see the throw represented on a field diagram, and review recorded results and their personal best.

The site includes four views:

- **Home**: An overview of the tool and links to the main features.
- **Field View**: Enter and record throw distances with a visual field animation.
- **Results**: Review all recorded throws, including the best distance.
- **Guide**: Read instructions about using the tool and understanding distances.

Recorded throws and the athlete name are saved in the browser's local storage, so they remain available when you move between pages in the same browser.

## Setup

### Requirements

- A modern web browser
- Node.js and npm, if using the local development server

### Option 1: Run with npm

1. Open a terminal in the project folder.
2. Install the project dependencies:

	```powershell
	npm install
	```

3. Start the site:

	```powershell
	npm start
	```

4. The site will open at `http://localhost:8080`. If it does not open automatically, copy that address into your browser.

### Option 2: Open the site directly

Open `views/index.html` in a modern web browser. You can then use the navigation links to move between the Home, Field View, Results, and Guide pages.

## Project Files

- `views/index.html`: Home page
- `views/field.html`: Throw entry and field view
- `views/results.html`: Recorded results
- `views/guide.html`: User guide
- `app.js`: Throw storage, validation, animation, and results logic
- `public/css/style.css`: Site styling and responsive layout