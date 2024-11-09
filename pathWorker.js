function calculatePath(roadNetwork, points) {
    const path = [];
    for (let i = 0; i < points.length - 1; i++) {
        const segment = astar(
            roadNetwork,
            points[i],
            points[i + 1]
        );
        if (segment) path.push(...segment);
    }
    return path;
}

function astar(roadNetwork, start, end) {
    const openSet = new Map();
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = `${start[0]},${start[1]}`;
    const endKey = `${end[0]},${end[1]}`;

    openSet.set(startKey, start);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(start, end));

    while (openSet.size > 0) {
        const current = getLowestFScore(openSet, fScore);
        const currentKey = `${current[0]},${current[1]}`;

        if (currentKey === endKey) {
            return reconstructPath(cameFrom, current);
        }

        openSet.delete(currentKey);
        closedSet.add(currentKey);

        const neighbors = getNeighbors(roadNetwork, current);
        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor[0]},${neighbor[1]}`;
            if (closedSet.has(neighborKey)) continue;

            const tentativeGScore = gScore.get(currentKey) + 
                distance(current, neighbor);

            if (!openSet.has(neighborKey)) {
                openSet.set(neighborKey, neighbor);
            } else if (tentativeGScore >= gScore.get(neighborKey)) {
                continue;
            }

            cameFrom.set(neighborKey, current);
            gScore.set(neighborKey, tentativeGScore);
            fScore.set(neighborKey, tentativeGScore + 
                heuristic(neighbor, end));
        }
    }

    return null;
}

function getLowestFScore(openSet, fScore) {
    let lowest = Infinity;
    let lowestPoint = null;

    for (const [key, point] of openSet) {
        const score = fScore.get(key);
        if (score < lowest) {
            lowest = score;
            lowestPoint = point;
        }
    }

    return lowestPoint;
}

function reconstructPath(cameFrom, current) {
    const path = [current];
    const currentKey = `${current[0]},${current[1]}`;

    let key = currentKey;
    while (cameFrom.has(key)) {
        current = cameFrom.get(key);
        path.unshift(current);
        key = `${current[0]},${current[1]}`;
    }

    return path;
}

function getNeighbors(roadNetwork, point) {
    const key = `${point[0]},${point[1]}`;
    return roadNetwork[key] || [];
}

function heuristic(a, b) {
    return distance(a, b);
}

function distance(a, b) {
    return Math.sqrt(
        Math.pow(a[0] - b[0], 2) + 
        Math.pow(a[1] - b[1], 2)
    );
}

// Web Worker message handler
self.onmessage = function(e) {
    const { roadNetwork, points } = e.data;
    const path = calculatePath(roadNetwork, points);
    self.postMessage(path);
};
