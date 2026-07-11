# Initial Release - 1.0

- other vessel heading: dont use wind direction anymore, only use ais data: COG

- home icon / follow mode
  - the chart should have 2 modes:
    - free drag
      - in free drag mode, we can move the map anywhere we want and it will stay fixed
      - any pan move will transition us to pan mode.
    - follow mode
      - clicking the Home icon will center and zoom us to our boat.
      - the viewport should continue to stay centered on our boat as new positions come in.
      - we should highlight the home icon somehow to show we are in follow mode
    - zooming does not change modes.
  - optional "Look ahead" mode for follow mode
    - configurable option in the UI/backend dialog box.
    - default true
    - biases the view towards the map ahead of us based on our speed and direction.

- add boat vectors
  - each boat should have a vector based on its COG, SOG, and configurable time.
  - vector should start from the bow of the boat and extend outwards in direction of travel.
  - length of vector based on SOG and a configurable time period.
  - time period should be configurable in the UI panel and backend.  use the following options:
    - 5 minutes
    - 10 minutes
    - 15 minutes (default)
    - 30 minutes
    - 60 minutes

- new appstore screenshots (`signalk.screenshots` in package.json is currently empty)