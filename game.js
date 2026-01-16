/* BioQuest MVP - Phaser 3
   - Student enters Class Code + Student ID
   - Loads question bank JSON
   - Q-blocks show in-game prompt
   - Stores results to localStorage via shared/storage.js
*/

const UI = document.getElementById("ui");

function uiTemplate() {
  UI.innerHTML = `
    <div class="panel">
      <div class="row">
        <div>
          <label>Class Code</label>
          <input id="classCode" placeholder="e.g., AB3K9Q" maxlength="12" />
          <div class="small">Teacher creates this code in the dashboard.</div>
        </div>
        <div>
          <label>Student ID (nickname or last-4)</label>
          <input id="studentId" placeholder="e.g., MARLIN123 or 4821" maxlength="24" />
          <div class="small">Use a non-identifying nickname if desired.</div>
        </div>
        <div>
          <label>Mode</label>
          <select id="mode">
            <option value="assessment">Assessment</option>
            <option value="practice">Practice</option>
          </select>
          <div class="small">Assessment uses attempts/lives; Practice can be infinite.</div>
        </div>
      </div>
      <div class="row">
        <button id="startBtn">Start World 1-1</button>
      </div>
      <div class="small">
        Tips: A/D or Arrow keys to move. Up to jump. Stomp enemies from above.
      </div>
    </div>
  `;
}

uiTemplate();

document.getElementById("startBtn").addEventListener("click", async () => {
  const classCode = (document.getElementById("classCode").value || "").trim().toUpperCase();
  const studentId = (document.getElementById("studentId").value || "").trim();

  if (!classCode || !studentId) {
    alert("Enter Class Code and Student ID.");
    return;
  }

  const mode = document.getElementById("mode").value;

  // Load class settings (local-first)
  const settings = BQ.getClassSettings(classCode);
  const session = {
    classCode,
    studentId,
    mode,
    settings,
    startedAtISO: new Date().toISOString()
  };

  // Load question bank
  const qb = await fetch("./data/questions_world1-1.json").then(r => r.json());

  // Hide UI
  UI.innerHTML = `<div class="panel"><span class="badge">Class ${classCode}</span> <span class="badge">Student ${studentId}</span> <span class="badge">${mode}</span></div>`;

  startGame(session, qb);
});

function startGame(session, questionBank) {
  const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: 960,
    height: 540,
    physics: {
      default: "arcade",
      arcade: { debug: false, gravity: { y: 0 } }
    },
    scene: [makeScene(session, questionBank)]
  };

  // Destroy old game if reloaded
  if (window.__bioquestGame) window.__bioquestGame.destroy(true);
  window.__bioquestGame = new Phaser.Game(config);
}

function makeScene(session, questionBank) {
  return class BioQuestScene extends Phaser.Scene {
    constructor() {
      super("BioQuestScene");
      this.score = 0;
      this.correct = 0;
      this.answered = 0;
      this.lives = 3;
      this.attempt = 1;
      this.usedQBlocks = new Set();
      this.levelStartMs = 0;
      this.qIndex = 0;
    }

    create() {
      const W = 960, H = 540;
      const levelWidth = 3000;

      // Apply settings
      const s = session.settings || {};
      const infiniteLives = (session.mode === "practice") ? true : !!s.infiniteLives;
      this.infiniteLives = infiniteLives;
      this.masteryAccuracy = Number(s.masteryAccuracy ?? 70);
      this.attemptsAllowed = Number(s.attemptsAllowed ?? 3);

      this.cameras.main.setBackgroundColor("#111");
      this.physics.world.setBounds(0, 0, levelWidth, H);

      // HUD
      this.hud = this.add.text(12, 10, "", { fontFamily: "monospace", fontSize: "16px", color: "#fff" })
        .setScrollFactor(0);

      // Platforms
      this.platforms = this.physics.add.staticGroup();

      // Ground
      for (let x = 0; x < levelWidth; x += 64) {
        const g = this.add.rectangle(x + 32, H - 20, 64, 40, 0x2a2a2a);
        this.platforms.add(g);
      }

      // Floating platforms (simple)
      this.addPlatform(380, 380, 180, 20);
      this.addPlatform(780, 320, 220, 20);
      this.addPlatform(1260, 360, 220, 20);
      this.addPlatform(1700, 320, 260, 20);
      this.addPlatform(2200, 360, 220, 20);

      // Player
      this.player = this.physics.add.rectangle(80, H - 80, 26, 34, 0x66ccff);
      this.player.body.setCollideWorldBounds(true);
      this.player.body.setGravityY(900);

      // Coins
      this.coins = this.physics.add.group({ allowGravity: false, immovable: true });
      this.spawnCoin(220, H - 90);
      this.spawnCoin(420, 340);
      this.spawnCoin(820, 280);
      this.spawnCoin(1760, 280);

      // Enemies
      this.enemies = this.physics.add.group({ collideWorldBounds: true });
      this.spawnEnemy(520, H - 80);
      this.spawnEnemy(980, H - 80);
      this.spawnEnemy(1500, H - 80);

      this.enemies.children.iterate(e => {
        e.body.setGravityY(900);
        e.body.setVelocityX(-80);
      });

      // Question blocks
      this.qblocks = this.physics.add.staticGroup();
      this.spawnQBlock(320, 300, "qb1");
      this.spawnQBlock(1100, 300, "qb2");
      this.spawnQBlock(2050, 300, "qb3");

      // Flagpole
      this.flag = this.physics.add.staticGroup();
      const flagRect = this.add.rectangle(levelWidth - 150, H - 120, 18, 200, 0x00ff66);
      this.flag.add(flagRect);

      // Collisions/overlaps
      this.physics.add.collider(this.player, this.platforms);
      this.physics.add.collider(this.enemies, this.platforms);

      this.physics.add.overlap(this.player, this.coins, this.onCoin, null, this);
      this.physics.add.overlap(this.player, this.enemies, this.onEnemy, null, this);
      this.physics.add.overlap(this.player, this.qblocks, this.onQBlock, null, this);
      this.physics.add.overlap(this.player, this.flag, this.onWin, null, this);

      // Camera
      this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
      this.cameras.main.setBounds(0, 0, levelWidth, H);

      // Controls
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

      this.levelStartMs = Date.now();
      this.updateHUD();
    }

    addPlatform(x, y, w, h) {
      const rect = this.add.rectangle(x, y, w, h, 0x444444);
      this.platforms.add(rect);
    }

    spawnCoin(x, y) {
      const c = this.add.rectangle(x, y, 14, 14, 0xffdd55);
      this.coins.add(c);
    }

    spawnEnemy(x, y) {
      const e = this.physics.add.rectangle(x, y, 26, 26, 0xff6666);
      this.enemies.add(e);
    }

    spawnQBlock(x, y, id) {
      const qb = this.add.rectangle(x, y, 26, 26, 0xddddff);
      qb.setStrokeStyle(2, 0xffffff);
      qb.qbId = id;
      qb.used = false;
      this.qblocks.add(qb);
    }

    update() {
      const left = this.cursors.left.isDown || this.keyA.isDown;
      const right = this.cursors.right.isDown || this.keyD.isDown;

      if (left) this.player.body.setVelocityX(-180);
      else if (right) this.player.body.setVelocityX(180);
      else this.player.body.setVelocityX(0);

      const onGround = this.player.body.blocked.down;
      if (this.cursors.up.isDown && onGround) this.player.body.setVelocityY(-420);

      // Enemy patrol reverse on walls
      this.enemies.children.iterate(e => {
        if (!e) return;
        if (e.body.blocked.left) e.body.setVelocityX(80);
        if (e.body.blocked.right) e.body.setVelocityX(-80);
      });

      this.updateHUD();
    }

    onCoin(player, coin) {
      coin.destroy();
      this.score += 10;
    }

    onEnemy(player, enemy) {
      const playerFalling = player.body.velocity.y > 50;
      const playerAbove = player.y + 10 < enemy.y;

      if (playerFalling && playerAbove) {
        enemy.destroy();
        player.body.setVelocityY(-260);
        this.score += 25;
        return;
      }

      if (!this.infiniteLives) {
        this.lives -= 1;
      }
      player.body.setVelocityX(player.x < enemy.x ? -220 : 220);
      player.body.setVelocityY(-260);

      if (!this.infiniteLives && this.lives <= 0) {
        this.endAttempt(false, "out_of_lives");
      }
    }

    onQBlock(player, qb) {
      if (qb.used) return;

      // Require hit from below
      const hitFromBelow = player.body.velocity.y < -50 && player.y > qb.y;
      if (!hitFromBelow) return;

      qb.used = true;
      qb.fillColor = 0x777799;

      // Pick next question (deterministic cycle)
      const q = questionBank.questions[this.qIndex % questionBank.questions.length];
      this.qIndex++;

      const choiceText = q.choices.map((c, i) => `${i + 1}) ${c}`).join("\n");
      const raw = prompt(`${q.prompt}\n\n${choiceText}\n\nType 1-4:`);

      this.answered += 1;
      const idx = parseInt(raw, 10) - 1;

      if (idx === q.answerIndex) {
        this.correct += 1;
        this.score += 50;
        this.spawnCoin(qb.x, qb.y - 30);
      } else {
        this.spawnEnemy(qb.x + 40, qb.y - 20);
      }
    }

    onWin() {
      this.endAttempt(true, "completed");
    }

    endAttempt(completed, reason) {
      const ms = Date.now() - this.levelStartMs;
      const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);

      const result = {
        levelId: questionBank.levelId,
        completed,
        reason,
        score: this.score,
        answered: this.answered,
        correct: this.correct,
        accuracy,
        livesRemaining: this.infiniteLives ? null : this.lives,
        attempt: this.attempt,
        durationMs: ms,
        atISO: new Date().toISOString(),
        masteryMet: accuracy >= this.masteryAccuracy
      };

      BQ.writeResult(session.classCode, session.studentId, result);

      const msg =
        `Level End\n\n` +
        `Completed: ${completed}\n` +
        `Accuracy: ${accuracy}% (Mastery: ${this.masteryAccuracy}%)\n` +
        `Score: ${this.score}\n` +
        `Answered: ${this.correct}/${this.answered}\n` +
        `Attempt: ${this.attempt}/${this.attemptsAllowed}\n`;

      alert(msg);

      if (session.mode === "assessment" && !result.masteryMet) {
        this.attempt += 1;
        if (this.attempt > this.attemptsAllowed) {
          this.scene.restart(); // fresh start, but attempts are logged
          return;
        }
      }

      this.scene.restart();
    }

    updateHUD() {
      const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);
      const lifeText = this.infiniteLives ? "∞" : String(this.lives);
      this.hud.setText(
        `Score ${this.score}   Lives ${lifeText}   Acc ${accuracy}%   Q ${this.correct}/${this.answered}`
      );
    }
  };
}
