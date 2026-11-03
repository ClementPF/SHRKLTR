package calc.entity;

import javax.persistence.*;

/**
 * Created by clementperez on 9/13/16.
 */

public class BaseStats {
    private double score;
    private double bestScore;
    private double worstScore;
    private int gameCount;
    private int winCount;
    private int loseCount;
    private int tieCount;
    private int winStreak;
    private int loseStreak;
    private int tieStreak;
    private int longuestWinStreak;
    private int longuestLoseStreak;
    private int longuestTieStreak;

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
        setBestScore(Math.max(this.score,this.bestScore));
        setWorstScore(Math.min(this.score, this.worstScore));
    }

    public int getGameCount() {
        return gameCount;
    }

    public void setGameCount(int gameCount) {
        this.gameCount = gameCount;
    }

    public void addWin() {
        gameCount++;
        winCount++;
        setWinStreak(winStreak + 1);
        loseStreak = 0;
        tieStreak = 0;
    }

    public void addLose() {
        gameCount++;
        loseCount++;
        setLoseStreak(loseStreak + 1);
        winStreak = 0;
        tieStreak = 0;
    }

    public void addTie() {
        gameCount++;
        tieCount++;
        setTieStreak(tieStreak + 1);
        winStreak = 0;
        loseStreak = 0;
    }

    public int getWinCount() {
        return winCount;
    }

    public void setWinCount(int winCount) {
        this.winCount = winCount;
    }

    public int getLoseCount() {
        return loseCount;
    }

    public void setLoseCount(int loseCount) {
        this.loseCount = loseCount;
    }

    public int getTieCount() {
        return tieCount;
    }

    public void setTieCount(int tieCount) {
        this.tieCount = tieCount;
    }

    public int getWinStreak() {
        return winStreak;
    }

    public void setWinStreak(int winStreak) {
        this.winStreak = winStreak;
        setLonguestWinStreak(Math.max(this.winStreak, this.longuestWinStreak));
    }

    public int getLoseStreak() {
        return loseStreak;
    }

    public void setLoseStreak(int loseStreak) {
        this.loseStreak = loseStreak;
        setLonguestLoseStreak(Math.max(this.loseStreak, this.longuestLoseStreak));
    }

    public int getTieStreak() {
        return tieStreak;
    }

    public void setTieStreak(int tieStreak) {
        this.tieStreak = tieStreak;
        setLonguestTieStreak(Math.max(this.tieStreak, this.longuestTieStreak));
    }

    public double getBestScore() {
        return bestScore;
    }

    public void setBestScore(double bestScore) { this.bestScore = bestScore;}

    public double getWorstScore() {
        return worstScore;
    }

    public void setWorstScore(double worstScore) {
        this.worstScore = worstScore;
    }

    public int getLonguestWinStreak() {
        return longuestWinStreak;
    }

    public void setLonguestWinStreak(int longuestWinStreak) {
        this.longuestWinStreak = longuestWinStreak;
    }

    public int getLonguestLoseStreak() {
        return longuestLoseStreak;
    }

    public void setLonguestLoseStreak(int longuestLoseStreak) {
        this.longuestLoseStreak = longuestLoseStreak;
    }

    public int getLonguestTieStreak() {return longuestTieStreak;}

    public void setLonguestTieStreak(int longuestTieStreak) {this.longuestTieStreak = longuestTieStreak; }

}
