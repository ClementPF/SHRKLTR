/*
 * Copyright 201100 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package calc;

import calc.DTO.StatsDTO;
import calc.entity.Sport;
import calc.entity.Stats;
import calc.entity.Tournament;
import calc.entity.User;
import calc.service.StatsService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.*;

import java.text.ParseException;
import java.util.UUID;

import static jdk.nashorn.internal.objects.NativeMath.random;
/*
@RunWith(SpringRunner.class)
@SpringBootTest(classes={StatsDTO.class})
public class DTOTests {

    @MockBean
    StatsService statsService;

    @Test
    public void statsDtoUnitTest() {

        ModelMapper modelMapper = new ModelMapper();

        Stats stats = new Stats();
        stats.setStatsId((new Double(Math.random())).longValue());
        stats.setScore(random(100));
        stats.setGameCount((int) Math.round(Math.random()*1000));
        stats.setWinCount((int) Math.round(Math.random()*1000));
        stats.setLoseCount((int) Math.round(Math.random()*1000));
        stats.setTieCount((int) Math.round(Math.random()*1000));
        stats.setWinStreak((int) Math.round(Math.random()*1000));
        stats.setLoseStreak((int) Math.round(Math.random()*1000));
        stats.setTieStreak((int) Math.round(Math.random()*1000));
        stats.setBestScore(random(100));
        stats.setWorstScore(random(100));
        stats.setLonguestWinStreak((int) Math.round(Math.random()*1000));
        stats.setLonguestLoseStreak((int) Math.round(Math.random()*1000));

        Sport sport = new Sport(UUID.randomUUID().toString());
        sport.setSportId(Math.round((Math.random()*1000000)));

        User u = new User();
        u.setUserId(Math.round((Math.random()*1000000)));
        u.setEmail(UUID.randomUUID().toString());
        u.setFirst(UUID.randomUUID().toString());
        u.setLast(UUID.randomUUID().toString());
        u.setUserName(UUID.randomUUID().toString());
        //u.setStats();
        //u.setOutcomes();
        u.setPassword(UUID.randomUUID().toString());


        Tournament t = new Tournament(UUID.randomUUID().toString(),sport,u);
        t.setIsOver(Math.random() < 0.5);
        stats.setTournament(t);

        StatsDTO statsDTO = modelMapper.map(stats, StatsDTO.class);

        assertThat(statsDTO.getStatsId()).isEqualTo(stats.getStatsId());
        assertThat(statsDTO.getScore()).isEqualTo(stats.getScore());
        assertThat(statsDTO.getBestScore()).isEqualTo(stats.getBestScore());
        assertThat(statsDTO.getGameCount()).isEqualTo(stats.getGameCount());
        assertThat(statsDTO.getWinCount()).isEqualTo(stats.getWinCount());
        assertThat(statsDTO.getLoseCount()).isEqualTo(stats.getLoseCount());
        assertThat(statsDTO.getTieCount()).isEqualTo(stats.getTieCount());
        assertThat(statsDTO.getWinStreak()).isEqualTo(stats.getWinStreak());
        assertThat(statsDTO.getLoseStreak()).isEqualTo(stats.getLoseStreak());
        assertThat(statsDTO.getTieStreak()).isEqualTo(stats.getTieStreak());
        assertThat(statsDTO.getLonguestWinStreak()).isEqualTo(stats.getLonguestWinStreak());
        assertThat(statsDTO.getLonguestLoseStreak()).isEqualTo(stats.getLonguestLoseStreak());
        assertThat(statsDTO.getLonguestTieStreak()).isEqualTo(stats.getLonguestTieStreak());


    }

    @Test
    public void statsEntityDtoEntity() {

        Stats stats = new Stats();
        stats.setStatsId((new Double(Math.random())).longValue());
        stats.setScore(random(100));
        stats.setGameCount((int) Math.round(Math.random()*1000));
        stats.setWinCount((int) Math.round(Math.random()*1000));
        stats.setLoseCount((int) Math.round(Math.random()*1000));
        stats.setTieCount((int) Math.round(Math.random()*1000));
        stats.setWinStreak((int) Math.round(Math.random()*1000));
        stats.setLoseStreak((int) Math.round(Math.random()*1000));
        stats.setTieStreak((int) Math.round(Math.random()*1000));
        stats.setBestScore(random(100));
        stats.setWorstScore(random(100));
        stats.setLonguestWinStreak((int) Math.round(Math.random()*1000));
        stats.setLonguestLoseStreak((int) Math.round(Math.random()*1000));

        Sport sport = new Sport(UUID.randomUUID().toString());
        sport.setSportId(Math.round((Math.random()*1000000)));

        User u = new User();
        u.setUserId(Math.round((Math.random()*1000000)));
        u.setEmail(UUID.randomUUID().toString());
        u.setFirst(UUID.randomUUID().toString());
        u.setLast(UUID.randomUUID().toString());
        u.setUserName(UUID.randomUUID().toString());
        //u.setStats();
        //u.setOutcomes();
        u.setPassword(UUID.randomUUID().toString());


        Tournament t = new Tournament(UUID.randomUUID().toString(),sport,u);
        t.setIsOver(Math.random() < 0.5);
        stats.setTournament(t);

        StatsDTO statsDTO = statsService.convertToDto(stats);
        Stats stats2 = new Stats();
        try {
            stats2 = statsService.convertToEntity(statsDTO);
        } catch (ParseException e) {
            e.printStackTrace();
            assertThat(false);
        }

        assertThat(stats.getStatsId()).isEqualTo(stats2.getStatsId());
        assertThat(stats.getScore()).isEqualTo(stats2.getScore());
        assertThat(stats.getBestScore()).isEqualTo(stats2.getBestScore());
        assertThat(stats.getGameCount()).isEqualTo(stats2.getGameCount());
        assertThat(stats.getWinCount()).isEqualTo(stats2.getWinCount());
        assertThat(stats.getLoseCount()).isEqualTo(stats2.getLoseCount());
        assertThat(stats.getTieCount()).isEqualTo(stats2.getTieCount());
        assertThat(stats.getWinStreak()).isEqualTo(stats2.getWinStreak());
        assertThat(stats.getLoseStreak()).isEqualTo(stats2.getLoseStreak());
        assertThat(stats.getTieStreak()).isEqualTo(stats2.getTieStreak());
        assertThat(stats.getLonguestWinStreak()).isEqualTo(stats2.getLonguestWinStreak());
        assertThat(stats.getLonguestLoseStreak()).isEqualTo(stats2.getLonguestLoseStreak());
        assertThat(stats.getLonguestTieStreak()).isEqualTo(stats2.getLonguestTieStreak());

        Tournament t2 = stats2.getTournament();

        assertThat(t.getTournamentId()).isEqualTo(t2.getTournamentId());
        assertThat(t.getDisplayName()).isEqualTo(t2.getDisplayName());
        assertThat(t.getName()).isEqualTo(t2.getName());
        assertThat(t.getOwner().getUserId()).isEqualTo(t2.getOwner().getUserId());
        assertThat(t.getSport().getSportId()).isEqualTo(t2.getSport().getSportId());

        User u2 = stats2.getUser();

        assertThat(u.getUserId()).isEqualTo(u2.getUserId());
        assertThat(u.getUserName()).isEqualTo(u2.getUserName());
    }
}
*/