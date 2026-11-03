/**
 * ELO Rating calculator
 *
 * Implements two methods 
 * 1. calculateMultiuser - calculate rating for multiple users
 * 2. calculate2UsersRating - for 2 user games
 *
 * @author radone@gmail.com
 */
package calc.ELO;

import java.util.HashMap;

public class EloRating {

    /**
     * Constructor
     */
    public EloRating() {
    }

    /**
     * Calculate ELO rating for multiuser
     *
     * Formula used to calculate rating for User1
     * NewRatingP1 = RatingP1 + K * (S - EP1)
     *
     * Where: 
     * RatingP1 = current rating for User1
     * K = K-factor 
     * S = actualScore (1 win, 0 lose) 
     * EP1 = Q1 / Q1 + Q2 + Q3 
     * Q(i) = 10 ^ (RatingP(i)/400)
     *
     * @param usersRating
     *            A {@literal HashMap<UserId, Rating>} keeping users id and current rating
     * @param userIdWinner
     *            The userId of the winner
     * @return A {@literal HashMap<UserId, Rating>} with new rating
     */
    static public HashMap<Integer, Double> calculateMultiuser(HashMap<Integer, Double> usersRating, int userIdWinner) {

        if (usersRating.size() == 0) {
            return usersRating;
        }

        HashMap<Integer, Double> newUsersPoints = new HashMap<Integer, Double>();

        // K-factor
        int K = 32;

        // Calculate total Q
        double Q = 0.0;
        for (int userId : usersRating.keySet()) {
            Q += Math.pow(10.0, ((double) usersRating.get(userId) / 400));
        }

        // Calculate new rating
        for (int userId : usersRating.keySet()) {

            /**
             * Expected rating for an user
             * E = Q(i) / Q(total)
             * Q(i) = 10 ^ (R(i)/400)
             */
            double expected = (double) Math.pow(10.0, ((double) usersRating.get(userId) / 400)) / Q;

            /**
             * Actual score is
             * 1 - if user is winner
             * 0 - if user losses
             * (another option is to give fractions of 1/number-of-users instead of 0)
             */
            int actualScore;
            if (userIdWinner == userId) {
                actualScore = 1;
            } else {
                actualScore = 0;
            }

            // new rating = R1 + K * (S - E);
            double newRating = usersRating.get(userId) + K * (actualScore - expected);

            // Add to HashMap
            newUsersPoints.put(userId, newRating);

        }

        return newUsersPoints;
    }

    /**
     * Calculate rating for 2 users
     *
     * @param user1Rating
     *            The rating of User1
     * @param user2Rating
     *            The rating of User2
     * @param outcome
     *            A string representing the game result for User1
     *            "+" winner
     *            "=" draw 
     *            "-" lose
     * @return New user rating
     */
    static public double calculate2UsersRating(double user1Rating, double user2Rating, String outcome) {

        double actualScore;

        // winner
        if (outcome.equals("+")) {
            actualScore = 1.0;
            // draw
        } else if (outcome.equals("=")) {
            actualScore = 0.5;
            // lose
        } else if (outcome.equals("-")) {
            actualScore = 0.5;
            // invalid outcome
        } else {
            return user1Rating;
        }

        // calculate expected outcome
        double exponent = (double) (user2Rating - user1Rating) / 400;
        double expectedOutcome = (1 / (1 + (Math.pow(10, exponent))));

        // K-factor
        int K = 32;

        // calculate new rating
        double newRating = user1Rating + K * (actualScore - expectedOutcome);

        return newRating;
    }
    /**
     * Calculate rating for 2 users
     *
     * @param user1Rating
     *            The rating of User1
     * @param user2Rating
     *            The rating of User2
     * @param outcome
     *            A string representing the game result for User1
     *            "+" winner
     *            "=" draw
     *            "-" lose
     * @return New user rating
     */
    static public double calculatePointValue(double user1Rating, double user2Rating, String outcome) {

        double actualScore;

        // winner
        if (outcome.equals("+")) {
            actualScore = 1.0;
            // draw
        } else if (outcome.equals("=")) {
            actualScore = 0.5;
            // lose
        } else if (outcome.equals("-")) {
            actualScore = 0.5;
            // invalid outcome
        } else {
            return user1Rating;
        }

        // calculate expected outcome
        double exponent = (double) (user2Rating - user1Rating) / 400;
        double expectedOutcome = (1 / (1 + (Math.pow(10, exponent))));

        // K-factor
        int K = 32;

        return K * (actualScore - expectedOutcome);
    }

    /**
     * Determine the rating constant K-factor based on current rating
     *
     * @param rating
     *            User rating
     * @return K-factor
     */
    static public int determineK(int rating) {
        int K;
        if (rating < 2000) {
            K = 32;
        } else if (rating >= 2000 && rating < 2400) {
            K = 24;
        } else {
            K = 16;
        }
        return K;
    }

}